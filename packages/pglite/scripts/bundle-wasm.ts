import * as fs from 'fs/promises'
import * as path from 'path'

async function findAndReplaceInFile(
  find: string | RegExp,
  replace: string,
  file: string,
): Promise<void> {
  const content = await fs.readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await fs.writeFile(file, replacedContent)
}

async function findAndReplaceInDir(
  dir: string,
  find: string | RegExp,
  replace: string,
  extensions: string[],
  recursive = false,
): Promise<void> {
  const files = await fs.readdir(dir, { withFileTypes: true })

  for (const file of files) {
    const filePath = path.join(dir, file.name)
    if (file.isDirectory() && recursive) {
      await findAndReplaceInDir(filePath, find, replace, extensions)
    } else {
      const fileExt = path.extname(file.name)
      if (extensions.includes(fileExt)) {
        await findAndReplaceInFile(find, replace, filePath)
      }
    }
  }
}

const copyFiles = async (srcDir: string, destDir: string) => {
  await fs.mkdir(destDir, { recursive: true })
  const files = await fs.readdir(srcDir)
  for (const file of files) {
    if (file.startsWith('.')) {
      continue
    }
    const srcFile = path.join(srcDir, file)
    const destFile = path.join(destDir, file)
    const stat = await fs.stat(srcFile)
    if (stat.isFile()) {
      await fs.copyFile(srcFile, destFile)
      console.log(`Copied ${srcFile} to ${destFile}`)
    }
  }
}

async function main() {
  await copyFiles('./release', './dist')
  await findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs'])
  await findAndReplaceInDir('./dist/contrib', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/vector', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pg_ivm', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pgtap', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pg_uuidv7', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir(
    './dist',
    `require("./postgres.js")`,
    `require("./postgres.cjs").default`,
    ['.cjs'],
  )

  // Pathways serves the core PGlite binaries from root-absolute public URLs
  // (`/pglite.wasm`, `/pglite.data`) so the PWA can precache them once and
  // avoid Vite emitting duplicate hashed copies inside `_nuxt/`.
  //
  // These replacements are intentionally applied to the generated Emscripten
  // bundle after copying `release/` into `dist/` because the asset resolution
  // logic lives inside the generated output, not the handwritten TypeScript.
  // Keep the package identity as `pglite.data`: PGlite's getPreloadedPackage()
  // validates by that exact name. Only the browser fetch URL should become
  // root-absolute.
  await findAndReplaceInFile(
    'var REMOTE_PACKAGE_BASE="pglite.data";var REMOTE_PACKAGE_NAME=Module["locateFile"]?Module["locateFile"](REMOTE_PACKAGE_BASE,""):REMOTE_PACKAGE_BASE;',
    'var REMOTE_PACKAGE_BASE=["pglite","data"].join(".");var REMOTE_PACKAGE_URL=typeof location==="object"&&location&&typeof location.origin==="string"&&location.origin!=="null"?new URL("/pglite.data",location.origin).href:REMOTE_PACKAGE_BASE;var REMOTE_PACKAGE_NAME=REMOTE_PACKAGE_BASE;',
    './dist/pglite.js',
  )
  await findAndReplaceInFile(
    'if(!fetched)fetchRemotePackage(REMOTE_PACKAGE_NAME,REMOTE_PACKAGE_SIZE,',
    'if(!fetched)fetchRemotePackage(REMOTE_PACKAGE_URL,REMOTE_PACKAGE_SIZE,',
    './dist/pglite.js',
  )
  await findAndReplaceInFile(
    'function findWasmBinary(){if(Module["locateFile"]){var f="pglite.wasm";if(!isDataURI(f)){return locateFile(f)}return f}return new URL("pglite.wasm",import.meta.url).href}',
    'function findWasmBinary(){if(typeof location==="object"&&location&&typeof location.origin==="string"&&location.origin!=="null"){return new URL("/pglite.wasm",location.origin).href}if(Module["locateFile"]){var f=["pglite","wasm"].join(".");if(!isDataURI(f)){return locateFile(f)}return f}return new URL(["pglite","wasm"].join("."),import.meta.url).href}',
    './dist/pglite.js',
  )
  await findAndReplaceInDir(
    './dist',
    /var n="pglite\.data",_="pglite\.data",l=Module\.locateFile\?Module\.locateFile\(_,""\):_,p=s\.remote_package_size;/g,
    'var n="pglite.data",_=typeof location==="object"&&location&&typeof location.origin==="string"&&location.origin!=="null"?new URL("/pglite.data",location.origin).href:["pglite","data"].join("."),l=n,p=s.remote_package_size;',
    ['.js'],
    true,
  )
  await findAndReplaceInDir(
    './dist',
    /c\|\|d\(l,p,/g,
    'c||d(_,p,',
    ['.js'],
    true,
  )
  await findAndReplaceInDir(
    './dist',
    /function findWasmBinary\(\)\{if\(Module\.locateFile\)\{var e="pglite\.wasm";return isDataURI\(e\)\?e:locateFile\(e\)\}return new URL\("pglite\.wasm",import\.meta\.url\)\.href\}/g,
    'function findWasmBinary(){if(typeof location==="object"&&location&&typeof location.origin==="string"&&location.origin!=="null"){return new URL("/pglite.wasm",location.origin).href}if(Module.locateFile){var e=["pglite","wasm"].join(".");return isDataURI(e)?e:locateFile(e)}return new URL(["pglite","wasm"].join("."),import.meta.url).href}',
    ['.js'],
    true,
  )
}

await main()
