/**
 *  Left-most fixed nav bar on application pane
 */

import * as React from "react";
import { StateRef } from "oneref";
import { AppState } from "../AppState";
import { Button, IconName } from "@blueprintjs/core";
import { Activity } from "./defs";
import * as actions from "../actions";
import { useToadTheme } from "../toadTheme";
import { ParseSplitIcon } from "./icons/ParseSplitIcon";
import { SunIcon } from "./icons/SunIcon";

export interface ActivityBarProps {
  activity: Activity;
  showDataSources: boolean;
  stateRef: StateRef<AppState>;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activity,
  showDataSources,
  stateRef,
}) => {
  const [theme, toggleTheme] = useToadTheme();
  const handleActivityClick =
    (buttonActivity: Activity) =>
    (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      if (activity === buttonActivity) {
        actions.setActivity("None", stateRef);
      } else {
        actions.setActivity(buttonActivity, stateRef);
      }
    };

  const activityButton = (
    target: Activity,
    iconName: IconName
  ): JSX.Element => (
    <Button
      icon={iconName}
      minimal={true}
      active={activity === target}
      onClick={handleActivityClick(target)}
    />
  );

  const dataSourceButton = showDataSources
    ? activityButton("DataSource", "database")
    : null;

  return (
    <div className={"activityBar"}>
      {dataSourceButton}
      {/* activityButton("Query", "build") */}
      {activityButton("Pivot", "pivot-table")}
      <Button
        icon={<ParseSplitIcon size={16} />}
        minimal={true}
        title="Toad Parse - Universal Column Extractor & Parser"
        onClick={() => actions.setParseDialogOpen(true, stateRef)}
      />
      {/* activityButton("Preferences", "cog") */}
      <div
        style={{
          marginTop: "auto",
          marginBottom: "12px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Button
          icon={theme === "dark" ? <SunIcon size={16} /> : "moon"}
          minimal={true}
          title={
            theme === "dark"
              ? "Switch to Light Mode"
              : "Switch to Dark Mode (Material Design 3)"
          }
          onClick={toggleTheme}
          className="theme-toggle-activity-btn"
        />
      </div>
    </div>
  );
};
