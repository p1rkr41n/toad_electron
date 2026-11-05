import * as reltab from "reltab";
/*
 * PagedDataView with fixed 1,000 rows pagination
 * and a 5-page sliding buffer (2 before + 1 current + 2 after = max 5,000 rows)
 */

export interface DataRow {
  _isLeaf: boolean;
  _depth: number;
  _pivot: string;
  _isOpen: boolean;
  [columnId: string]: reltab.Scalar;
}

export class PagedDataView {
  schema: reltab.Schema;
  totalRowCount: number;
  offset: number; // sliding buffer starting row index in database
  rawData: Array<DataRow>; // sliding buffer rows (at most 5,000 rows)
  currentPage: number; // 1-indexed current page
  pageSize: number; // rows per page (1,000)

  constructor(
    schema: reltab.Schema,
    totalRowCount: number,
    offset: number,
    items: Array<DataRow>,
    currentPage: number = 1,
    pageSize: number = 1000
  ) {
    this.schema = schema;
    this.totalRowCount = totalRowCount;
    this.offset = offset;
    this.rawData = items;
    this.currentPage = currentPage;
    this.pageSize = pageSize;
  }

  withPage(newPage: number): PagedDataView {
    return new PagedDataView(
      this.schema,
      this.totalRowCount,
      this.offset,
      this.rawData,
      newPage,
      this.pageSize
    );
  }

  // Returns number of rows on current page (up to 1,000) for SlickGrid rendering
  getLength(): number {
    const pageStart = (this.currentPage - 1) * this.pageSize;
    if (pageStart >= this.totalRowCount) {
      return 0;
    }
    return Math.min(this.pageSize, this.totalRowCount - pageStart);
  }

  getOffset(): number {
    return (this.currentPage - 1) * this.pageSize;
  }

  getItemCount(): number {
    return this.rawData.length;
  }

  getGlobalIndex(pageIndex: number): number {
    return (this.currentPage - 1) * this.pageSize + pageIndex;
  }

  getItem(pageIndex: number): DataRow | null {
    if (pageIndex < 0 || pageIndex >= this.getLength()) {
      return null;
    }
    const globalIdx = this.getGlobalIndex(pageIndex);
    const itemIndex = globalIdx - this.offset;

    if (itemIndex >= 0 && itemIndex < this.rawData.length) {
      return this.rawData[itemIndex];
    }
    return null;
  }

  getItemMetadata(index: number): any {
    let ret: any = {};
    const item = this.getItem(index);

    if (item && !item._isLeaf) {
      ret.cssClasses = "grid-aggregate-row";
    }

    return ret;
  }
}
