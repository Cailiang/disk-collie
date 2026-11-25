import { describe,expect,it } from 'vitest'
import { localeCatalogs,supportedLocales,translate } from './localization'
describe('language resources',()=>{
  it('ships complete catalogs with matching interpolation variables',()=>{
    const reference=localeCatalogs['en-US']
    for(const locale of supportedLocales){
      const catalog=localeCatalogs[locale.id]
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(reference).sort())
      for(const key of Object.keys(reference)){
        const slots=(v:string):string[]=>[...v.matchAll(/\{(\w+)\}/g)].map((v)=>v[1]).sort()
        expect(slots(catalog[key]),key).toEqual(slots(reference[key]))
      }
    }
  })
  it('interpolates values without interpreting markup or losing zero',()=>{
    expect(translate('en-US','common.selected',{count:0})).toBe('0 selected')
    expect(translate('zh-CN','common.selected',{count:2})).toBe('已选 2 项')
    expect(translate('en-US','missing.key')).toBe('missing.key')
  })
})
