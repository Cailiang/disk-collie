import type {StartupCatalog,StartupGroup,StartupItem} from './startup-types'
/** Group only by an adapter-proven application or executable identity. */
export function startupGroups(catalog:StartupCatalog):StartupGroup[] {
  const groups=new Map<string,StartupGroup>()
  for(const item of catalog.items){
    const id=item.ownerId||item.id
    let group=groups.get(id)
    if(!group){group={id,name:item.owner||item.name,publisher:item.publisher,items:[],state:'unknown',system:true};groups.set(id,group)}
    group.items.push(item);group.system=group.system&&item.scope==='system'
    if(!group.publisher)group.publisher=item.publisher
  }
  for(const group of groups.values()){
    const states=new Set(group.items.map(item=>item.state))
    group.state=states.size===1?group.items[0].state:states.has('unknown')?'unknown':'mixed'
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name))
}
export function filterStartupGroups(groups:StartupGroup[],query:string,status:string,showSystem:boolean):StartupGroup[] {
  const search=query.trim().toLocaleLowerCase()
  return groups.filter(group=>(showSystem||!group.system)&&(!search||[group.name,group.publisher,...group.items.flatMap(item=>[item.name,item.target,item.configuration])].join(' ').toLocaleLowerCase().includes(search))&&(status==='all'||status==='orphan'?status==='all'||group.items.some(item=>item.orphan):status==='enabled'?group.items.some(item=>item.state==='enabled'):group.state==='disabled'))
}
