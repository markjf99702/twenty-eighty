import { describe, expect, it } from "vitest";
import { finishText } from "../web/src/ui/format";

describe("page wording", () => {
  it("says how a club's season ended in plain words", () => {
    expect(finishText("Won World Series")).toBe("won the World Series");
    expect(finishText("Lost World Series")).toBe("lost in the World Series");
    expect(finishText("Lost Championship Series")).toBe("lost in the Championship Series");
    expect(finishText("Lost Division Series")).toBe("lost in the Division Series");
    expect(finishText("Lost Wild Card Series")).toBe("lost in the Wild Card Series");
    expect(finishText("Missed postseason")).toBe("missed the postseason");
  });
});
