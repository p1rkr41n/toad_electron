import * as React from "react";
import * as reltab from "reltab";

export interface SingleColumnSelectProps {
  schema: reltab.Schema;
  label: string;
  value: string | null | undefined;
  disabled: boolean;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

export const SingleColumnSelect: React.FC<SingleColumnSelectProps> = React.memo(({
  schema,
  label,
  value,
  disabled,
  onChange,
}) => {
  const colOptions = React.useMemo(() => {
    const columnIds = schema.columns.slice();
    columnIds.sort((cid1, cid2) =>
      schema.displayName(cid1).localeCompare(schema.displayName(cid2))
    );
    const opts = columnIds.map((cid) => (
      <option key={cid} value={cid}>
        {schema.displayName(cid)}
      </option>
    ));
    opts.unshift(
      <option key="__none" value="__none">
        none
      </option>
    );
    return opts;
  }, [schema]);

  const propVal = value;
  const selVal = propVal === null ? "__none" : propVal;
  return (
    <div className="pivot-leaf-select">
      <label>Pivot Tree Leaf Level:</label>
      <select
        className="scs-select"
        disabled={disabled}
        value={selVal}
        onChange={onChange}
      >
        {colOptions}
      </select>
    </div>
  );
});
