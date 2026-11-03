import * as Immutable from "immutable";
import { ViewParams } from "./ViewParams";
import { QueryView } from "./QueryView";
import { PagedDataView } from "./PagedDataView";
import { Timer } from "./Timer";
import * as reltab from "reltab";
import { DataSourcePath } from "reltab";

/**
 * Immutable representation of all state associated
 * with a single view.
 *
 * Consists of user-editable ViewParams plus any associated
 * query / network / render state
 */
export interface ViewStateProps {
  dbc: reltab.DataSourceConnection | null;
  dsPath: DataSourcePath | null;
  baseQuery: reltab.QueryExp | null;
  baseSchema: reltab.Schema | null; // always in sync with baseQuery

  viewParams: ViewParams;
  initialViewParams: ViewParams; // for dirty detection
  loadingTimer: Timer;
  viewportTop: number;
  viewportBottom: number;
  queryView: QueryView | undefined | null;
  dataView: PagedDataView | undefined | null;

  delayedCalcMode: boolean; // If true, don't recalc from view params until user hits "apply"
  currentPage: number; // 1-indexed current page
  pageSize: number;
}

let _defaultPageSize = 1000;
export const getDefaultPageSize = (): number => _defaultPageSize;
export const setDefaultPageSize = (size: number): void => {
  if (typeof size === "number" && !isNaN(size) && size > 0) {
    _defaultPageSize = Math.floor(size);
  }
};

const defaultViewStateProps: ViewStateProps = {
  dbc: null,
  dsPath: null,
  baseQuery: null,
  baseSchema: null,
  viewParams: new ViewParams(),
  initialViewParams: new ViewParams(),
  loadingTimer: new Timer(),
  viewportTop: 0,
  viewportBottom: 0,
  queryView: null,
  dataView: null,
  delayedCalcMode: true,
  currentPage: 1,
  get pageSize() {
    return _defaultPageSize;
  },
};

export class ViewState
  extends Immutable.Record(defaultViewStateProps)
  implements ViewStateProps
{
  public readonly dbc!: reltab.DataSourceConnection;
  public readonly dsPath!: DataSourcePath;
  public readonly baseQuery!: reltab.QueryExp;
  public readonly baseSchema!: reltab.Schema; // always in sync with baseQuery
  public readonly viewParams!: ViewParams;
  public readonly initialViewParams!: ViewParams;
  public readonly loadingTimer!: Timer;
  public readonly viewportTop!: number;
  public readonly viewportBottom!: number;
  public readonly queryView!: QueryView | undefined | null;
  public readonly dataView!: PagedDataView | undefined | null;
  public readonly delayedCalcMode!: boolean;
  public readonly currentPage!: number;
  public readonly pageSize!: number;
}
