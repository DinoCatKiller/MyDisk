import type { JSX } from "@solidjs/web";

import { Card, CardBody } from "~/components/ui/card";
import { ConstructionIcon } from "~/components/ui/icons";

export type PlaceholderProps = {
  title: string;
  description: string;
  hint?: string;
  children?: JSX.Element;
};

export function FeaturePlaceholder(props: PlaceholderProps) {
  return (
    <Card>
      <CardBody>
        <div style={{ display: "flex", gap: "12px", "align-items": "flex-start" }}>
          <span style={{ color: "var(--md-warning)", display: "inline-flex", "margin-top": "2px" }}>
            <ConstructionIcon size={20} />
          </span>
          <div>
            <div style={{ "font-weight": 600, "margin-bottom": "4px" }}>{props.title}</div>
            <div style={{ color: "var(--md-text-soft)", "font-size": "13px" }}>
              {props.description}
            </div>
            {props.hint ? (
              <div
                style={{
                  "margin-top": "8px",
                  color: "var(--md-text-muted)",
                  "font-size": "12.5px",
                }}
              >
                {props.hint}
              </div>
            ) : null}
            {props.children}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
