import * as nodeFs from 'node:fs'

// Electron's regular fs treats .asar files as virtual directories with synthetic
// identities. Disk operations must snapshot the physical archive itself.
const physicalFs:typeof nodeFs=process.versions.electron?require('original-fs'):nodeFs
export const {lstat,readdir,readlink,readFile,realpath,rm}=physicalFs.promises
