import {describe,expect,it} from 'vitest'
import {storageProcessMatcher} from './storage-process-match'
describe('cleanup process ownership',()=>{
  it('does not match short developer tools inside unrelated paths and browser names',()=>{
    const running=storageProcessMatcher(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Users/alex/golang/notes','/Applications/Code.app/Contents/MacOS/Electron'])
    expect(running('go')).toBe(false);expect(running('make')).toBe(false);expect(running('Google Chrome')).toBe(true)
  })
  it('recognizes package-manager entry scripts, compilers and Java Gradle daemons',()=>{
    const running=storageProcessMatcher(['/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js install','/usr/local/go/bin/go build','/usr/bin/java -cp gradle.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.5','C:\\Tools\\cargo.exe build'])
    for(const name of ['npm','go','GradleDaemon','cargo'])expect(running(name)).toBe(true)
    expect(running('pip')).toBe(false)
  })
})
