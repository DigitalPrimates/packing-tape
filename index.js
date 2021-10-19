#! /usr/bin/env node
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');
const {
  intersect
} = require('semver-intersect');
const minimist = require('minimist');

const isObjectLike = x => typeof x === 'object' && x !== null;

const filter = (o, p, keySelector=Object.keys) => {
  const p2 = k => p(o[k], k, o);
  const keys = keySelector(o).filter(p2);
  const r = (acc,k) => {
      acc[k] = o[k];
      return acc;
  }
  return keys.reduce(r,{});
};

const toSatisfiedDependency = (dependency, v1, v2) => {
  try {
    return {
      [dependency]:intersect(v1, v2)
    }
  } catch ({message}) {
    throw new Error(`Error with ${dependency} - ${v1} incompatible with ${v2}`);
  }
};

const localProjectFilter = (links={}) => 
  Object
    .keys(links)
    .map(link=>dependency=>link!=dependency)
    .reduce((accFn, fn)=>dependency=>fn(dependency) && accFn(dependency), ()=>true);

const validateWorkspace = ignoreFilter => workspace => {
  
  if ((isObjectLike(workspace) || isObjectLike(workspace.links))) {
    const {
      links
    } = workspace;

    const relevantProjects = filter(links, ignoreFilter);
    const invalidProjects = filter(relevantProjects, (v, k)=>{
      const sourceDirectory = path.resolve(k);
      const exists = fs.existsSync(path.resolve(k));
      const pkgIsDirectory = exists && fs.lstatSync(sourceDirectory).isDirectory();
      const hasPackageJson = pkgIsDirectory && fs.existsSync(path.resolve(sourceDirectory, 'package.json'));

      return !hasPackageJson;
    });

    if (invalidProjects.length) {
      throw new Error(`Workspace JSON references non-existing directories/packages for projects ${invalidProjects.join(',')}`);
    }

  } else {
    throw new Error('Workspace JSON shape is incorrect');
  }

  return true;
};

const toDependenciesGenerator = links => (accDependencies={}, projectDependencies={}) => {
  
  return Object
  .keys(projectDependencies)
  .filter(localProjectFilter(links))
  .reduce((innerAcc, dependency)=>{
    
    return (!innerAcc[dependency] || innerAcc[dependency] === projectDependencies[dependency])
                ? Object.assign(innerAcc, {[dependency]:projectDependencies[dependency]})
                : Object.assign(innerAcc, toSatisfiedDependency(dependency, innerAcc[dependency], projectDependencies[dependency]));
  }, accDependencies);
}

//todo: refactor toCompleteWorkspaceDependencies in a way that doesnt require us to pass in a filter.
const toCompleteWorkspaceDependencies = ignoreFilter => packageJsonPathDictionary => {
  
  const dependenciesGenerator = toDependenciesGenerator(packageJsonPathDictionary);

  return Object
    .keys(packageJsonPathDictionary)
    .map(key=>packageJsonPathDictionary[key])
    .filter(ignoreFilter)
    .map(dir=>path.resolve(dir, 'package.json'))
    .map(file=>String(fs.readFileSync(file)))
    .map(json=>JSON.parse(json))
    .reduce(({devDependencies={}, dependencies={}}, {devDependencies: projDevDependencies, dependencies:projDependencies})=>{

        return {
          devDependencies: dependenciesGenerator(devDependencies, projDevDependencies),
          dependencies: dependenciesGenerator(dependencies, projDependencies)
        }

    }, {});

};

const createProjectSymLinks = ignoreFilter => links => {
  const ensureScopedDirectories = modulePath => {
    const parts = modulePath.split(path.sep);
    const prefix = parts.slice(0, -1);
    const dirPath = prefix.join(path.sep);
  
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, {recursive : true});
    }
  };
  
  const symLinks =
     Object
      .keys(links)
      .filter(key=>ignoreFilter(links[key]))
      .map(package=>{
        return {
          sourceDirectory: path.resolve(links[package]),
          moduleDirectory : path.resolve('node_modules', ...package.split('/'))
        };
      })
      .forEach(({sourceDirectory, moduleDirectory})=>{
        const exists = fs.existsSync(moduleDirectory);
        const pkgIsSymLink = exists && fs.lstatSync(moduleDirectory).isSymbolicLink();
  
        if (!pkgIsSymLink) {
          ensureScopedDirectories(moduleDirectory);  
          console.log(`Link created between ${sourceDirectory} and ${moduleDirectory}`);
          fs.symlinkSync(sourceDirectory, moduleDirectory, "dir");
        }
      });
};

const getFilePath = (pathArg, fileName = '') => {

  if (!fs.existsSync(pathArg)) {
    console.log(`${fileName} file not found at ${pathArg}`);
    process.exit(-1);
  }

  return path.resolve(pathArg);

}

const parseWorkspaceFile = (workspaceStr, ignoreFilter=()=>true) => {
  
  let workspace;
  try {
    workspace = JSON.parse(workspaceStr);
    validateWorkspace(ignoreFilter)(workspace);  
  }
  catch (e) {
    console.log(`Workspace file at ${workspacePath} does not contain a valid workspace description\n${e.message}`);
    process.exit(-1);
  }

  return workspace;
  
};

const readFile = (filePath) => {
  try {
    return fs.readFileSync(filePath)
  }
  catch (e) {
    console.log(`unable to read ${filePath}\n${e.message}`);
    process.exit(-1);
  }
  
}

const writeToFile = (path, value) => {
  
  try{
    fs.writeFileSync(workspacePackage, value);
  }
  catch(e) {
    console.log(`Unable to write to ${path}\n${e.message}`);
    process.exit(-1);
  }

}

const argv = minimist(process.argv.slice(2));

if (argv.h || argv.help) {
  console.log('packing-tape [-[w]orkspace=workspace.json] [-[i]gnore=(comma separated list of modules to skip)] [-[c] use npm ci instead of npm i]');
  process.exit(0);
}

const shouldCi = !!argv.c;
const workspaceArg = argv.w || argv.workspace || 'workspace.json';
const ignoreArg = argv.i || argv.ignore || '';
const ignoreFilter = package => !ignoreArg.split(',').includes(package);
const workspacePath = getFilePath(workspaceArg, 'Workspace');
const workspacePackage = getFilePath('package.json', 'Workspace package.json');

//1. Aggregate all workspace and subproject dependencies / devDependencies and return an object containing these
// dependencies / devDependencies.  The sub projects will not appear as dependencies in this object.
const {
  links = {}
} = parseWorkspaceFile(readFile(workspacePath), ignoreFilter);

const dependencies = toCompleteWorkspaceDependencies(ignoreFilter)(
  Object.assign({}, links, {['./']: './'})
);

//2. Replace the workspace's package.json dependencies / devDependencies with the newly generated 
// dependencies / devDependencies
const workspacePackageJSON = JSON.parse(readFile(workspacePackage));
const overridePackageJSON = Object.assign({}, workspacePackageJSON, dependencies);
writeToFile(workspacePackage, JSON.stringify(overridePackageJSON, null, 4))

//3. Install the dependencies listed in the package.json
const command = shouldCi ? `npm ci` : `npm i`;
if (shouldCi) console.log('Performing clean slate (ci) installation.');
child_process.execSync(command);

//4. Create sym links to the sub projects in node_modules.
createProjectSymLinks(ignoreFilter)(links);

console.log('Installation Finished');
