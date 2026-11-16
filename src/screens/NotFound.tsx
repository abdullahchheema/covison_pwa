import { switchTab } from "../lib/router";
import { Empty, Screen } from "../ui/kit";

export function NotFound() {
  return (
    <Screen title="Not found" backLabel="Back">
      <Empty icon="info" title="This page doesn't exist" action={<button class="btn primary sm press" onClick={() => switchTab("/")}>Go home</button>} />
    </Screen>
  );
}
