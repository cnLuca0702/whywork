import type { IStyleData } from '@univerjs/core'
export type SheetStyle = IStyleData
export interface SheetCell {v?:string|number|boolean|null;f?:string;t?:number;s?:SheetStyle|string|null}
export interface WorkbookSnapshot {
  id:string;name:string;appVersion:string;locale:string;sheetOrder:string[];
  styles?:Record<string,SheetStyle>;
  sheets:Record<string,{id:string;name:string;rowCount:number;columnCount:number;cellData:Record<string,Record<string,SheetCell>>;mergeData?:{startRow:number;endRow:number;startColumn:number;endColumn:number}[];rowData?:Record<string,{h?:number;hd?:number}>;columnData?:Record<string,{w?:number;hd?:number}>}>;
}
