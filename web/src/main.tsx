import { render } from "preact";
import { App } from "./ui/App";
import "./ui/styles.css";

render(<App />, document.getElementById("app")!);

// The junkdrawer.works copy keeps itself for playing offline.
if (import.meta.env.VITE_SITE && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
