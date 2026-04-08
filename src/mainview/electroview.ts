import { Electroview } from "electrobun/view";
import { type MainViewRPC } from "../shared/types";

const rpc = Electroview.defineRPC<MainViewRPC>({
  handlers: {
    requests: {},
    messages: {
      statusUpdate: (info) => {
        window.dispatchEvent(
          new CustomEvent("gdp:status", { detail: info })
        );
      },
      logPush: (entries) => {
        window.dispatchEvent(
          new CustomEvent("gdp:logPush", { detail: entries })
        );
      },
    },
  },
});

const electroview = new Electroview({ rpc });

export { electroview, rpc };
export default electroview;
