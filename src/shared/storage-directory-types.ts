/** A Main-registered, complete folder snapshot reviewed before a recoverable Trash operation. */
export interface StorageDirectoryPlan {
  id:string
  generation:number
  entryId:number
  path:string
  name:string
  size:number
  allocated:number
  files:number
  directories:number
  links:number
  /** Files and links inside a hidden directory, or whose own name starts with a dot. */
  hiddenFiles:number
  /** Name-based review hints, never extracted secret values. */
  sensitiveFiles:number
  sensitiveExamples:string[]
  applicationData?:boolean
}
