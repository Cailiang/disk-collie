import type {StorageApplication,StorageApplicationUpdateResult} from '../../shared/storage-types'
/** Apply one update to the latest inventory so concurrent completions cannot undo each other. */
export function mergeApplicationUpdate(applications:StorageApplication[],id:string,result:StorageApplicationUpdateResult):StorageApplication[] {
  if(result.status!=='updated')return applications
  return applications.map((application)=>application.id===id?{...application,...(result.application||{version:application.latestVersion||application.version,updateAvailable:false,latestVersion:null})}:application)
}
