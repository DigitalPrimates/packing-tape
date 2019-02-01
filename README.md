# packing-tape

## What is packing-tape
Simplified workspace for project dependencies living in multiple git repositories.  `packing-tape` will aggregate the dependencies/ devDependencies for all subprojects and inject them into the workspace package.json file.  Once injected `packing-tape`  will install the dependencies, hoisting them to the project level. 

Given a workspace with the following structure:

```
myWorkspace
|
|___ myProjectA
|       |
|       |___ package.json
|
|___ myProjectB
|       |
|       |___ package.json
|
|___ package.json
|
|___ workspace.json

```

running `packing-tape` will modify the workspace package.json file to include all subproject dependencies.  Once modified `packing-tape` will install and hoist all dependencies to the workspace level.

```
myWorkspace
|
|___ node_modules
|       |
|       |___ All dependencies
|
|___ myProjectA
|       |
|       |___ package.json
|
|___ myProjectB
|       |
|       |___ package.json
|
|___ package.json (Modified)
|
|___ workspace.json

```

In the case where multiple projects contain different but compatible versions of a dependency, `packing-tape` will resolve the conflict and install version of the dependency that satisfies both projects.  If the conflict can not be resolved, `packing-tape` will throw an error notifying you of the conflict. 

Note:  When versioning your project, only commit your base package.json config, not the version modified by `packing-tape`.

## Prerequisites 
1. Your workspace dir must contain a `workspace.json` that maps `module name` to `module dir`.

```
{
    "links": {
        "myProjectA": "myProjectA",
        "myProjectB": "myProjectB"
    }
}
```
2. Submodules must contain a [npm `package.json`](https://docs.npmjs.com/files/package.json) file.

## Usage

1. install `packing-tape` as a dev dependency `npm i packing-tape --save-dev`
2. Add `packing-tape` as a script in the main projects package.json. 
```
"scripts": {
    "workspace:install": "packing-tape"
}
```
3. Run the `packing-tape` script defined in the projects package.json 
`npm run workspace:install`

## Optional Arguments

`-[w]orkspace=workspace.json`: specifies the path to the workspace's package.json file.  By default `packing-tape` looks for the package in the main workspace dir.

```packing-tape -w=configs/workspace.json```

`-[i]gnore=(comma separated list of modules to skip)`: In the case that you would like to skip modules listed in `workspace.json` as `links` you can use `-i` to indicate the moudles to skip.

```packing-tape -i=myProjectA,myProjectB```

`-[c] use npm ci instead of npm i'`: Uses the `npm ci` command instead of `npm i`.

```packing-tape -c```
