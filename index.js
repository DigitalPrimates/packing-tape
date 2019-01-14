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

const reduce = (o, f = identity, acc = {}, iteratee=Object.keys) => {
  const f2 = (acc, k) => f(acc, o[k], k, o);
  return iteratee(o)
          .reduce(f2, acc);
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

const localProjectFilter = links => 
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

const toWorkspaceDependencies = ignoreFilter => links => {
    return Object
      .keys(links)
      .map(key=>links[key])
      .filter(ignoreFilter)
      .map(dir=>path.resolve(dir, 'package.json'))
      .map(file=>String(fs.readFileSync(file)))
      .map(json=>JSON.parse(json))
      .map(({devDependencies, dependencies})=>Object.assign({}, devDependencies, dependencies))
      .reduce((acc, projectDeps)=>{
        return Object
            .keys(projectDeps)
            .filter(localProjectFilter(links))
            .reduce((innerAcc, dependency)=>{
            
              return (!innerAcc[dependency] || innerAcc[dependency] === projectDeps[dependency])
                          ? Object.assign(innerAcc, {[dependency]:projectDeps[dependency]})
                          : Object.assign(innerAcc, toSatisfiedDependency(dependency, innerAcc[dependency], projectDeps[dependency]));
            }, acc);
      }, {});
};
const installHoistedDependencies = dependencies => {
  //NPM with the no-save options seems to have a race condition that missed multiple dependencies
  //therefore we are enforcing a limited mutation strategy by restoring package.json
  const workspacePackage = String(fs.readFileSync(path.resolve('package.json')));
  try {
    reduce(dependencies, (acc, version, dep)=>{
      const [
        head = `npm i `,
        ...rest
      ] = acc;

      return (head.length < 512)
                ?  [`${head} ${dep}@${version}`, ...rest]
                :  [`npm i ${dep}@${version}`, head, ...rest]
    }, [])
    .forEach(line=>{
      console.log(line);
      child_process.execSync(line);
    });
  }
  catch (e) {
    console.log(e);
    throw new Error('Unknown Error in package installation');
  }
  finally {
    fs.writeFileSync(path.resolve('package.json'), workspacePackage);
  }
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



const argv = minimist(process.argv.slice(2));

if (argv.h || argv.help) {
  console.log('packing-tape [-[w]orkspace=workspace.json] [-[i]gnore=(comma separated list of modules to skip)]');
  process.exit(0);
}

const workspaceArg = argv.w || argv.workspace || 'workspace.json';
const ignoreArg = argv.i || argv.ignore || '';

const workspacePath = path.resolve(workspaceArg);
const ignoreFilter = package => !ignoreArg.split(',').includes(package);

if (!fs.existsSync(workspacePath)) {
  console.log(`Workspace file not found at ${workspacePath}`);
  process.exit(-1);
}

let workspace;
try {
  const workspaceStr = String(fs.readFileSync(workspacePath));
  workspace = JSON.parse(workspaceStr);
  validateWorkspace(ignoreFilter)(workspace);  
}
catch (e) {
  console.log(`Workspace file at ${workspacePath} does not contain a valid workspace description\n${e.message}`);
  process.exit(-1);
}

const {
  links = {}
} = workspace;

const dependencies = toWorkspaceDependencies(ignoreFilter)(links);
installHoistedDependencies(dependencies);
createProjectSymLinks(ignoreFilter)(links);

console.log('Installation Finished')
