import { desktopChatStateExpression } from "./chat-storage-fixture.mjs";
// Use a fresh isolated WebView profile. No skill, knowledge, or model data is written.
// Example: node scripts/verify-composer-layout.mjs 9350 [wide.png] [compact.png]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";

const { command, evaluate, waitFor, reload, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
let isolated = false;
async function key(key, code, windowsVirtualKeyCode) {
  for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", {
    type, key, code, windowsVirtualKeyCode, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}),
  });
}
async function checkLayout(width, height, screenshot) {
  await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await waitFor("document.querySelector('.app-shell').getAnimations().length === 0");
  const layout = await evaluate(`(() => {
    const context = document.querySelector('.composer-context');
    const [skill, knowledge] = [...context.children].map(el => el.getBoundingClientRect());
    const tools = document.querySelector('.composer-tools').getBoundingClientRect();
    const meta = document.querySelector('.composer-meta').getBoundingClientRect();
    return { sameRow: Math.abs(skill.top - knowledge.top) < 1 && skill.right < knowledge.left,
      noOverflow: context.scrollWidth === context.clientWidth,
      toolbarFits: tools.right < meta.left && meta.right <= document.querySelector('.composer-toolbar').getBoundingClientRect().right + 1,
      fits: [...context.children].every(group => {
        const rect = group.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && [...group.children].every(child => {
          const box = child.getBoundingClientRect();
          return box.left >= rect.left && box.right <= rect.right && box.top >= rect.top && box.bottom <= rect.bottom;
        });
      }), selectWidths: [...context.querySelectorAll('select')].map(select => select.getBoundingClientRect().width) };
  })()`);
  assert.ok(layout.sameRow && layout.noOverflow && layout.fits && layout.toolbarFits, JSON.stringify(layout));
  assert.ok(layout.selectWidths.every(width => width >= 60), JSON.stringify(layout));
  if (screenshot) {
    const { data } = await command("Page.captureScreenshot", { format: "png" });
    writeFileSync(screenshot, Buffer.from(data, "base64"));
  }
  console.log(`PASS: ${width}×${height} selectors share one row without overlap or overflow`);
}
try {
  await waitFor("Boolean(document.querySelector('.composer-context')) && [...document.querySelectorAll('.composer-context select')].every(select => !select.disabled)");
  assert.equal(await evaluate(`${desktopChatStateExpression}.conversations?.length ?? 0`), 0,
    "Use a fresh isolated profile, not real chats");
  isolated = true;
  for (const [id, label, manager, section] of [
    ["chat-skill", "选择技能", "manage-skills", "Skills"],
    ["chat-knowledge", "选择知识库", "manage-knowledge", "知识库"],
  ]) {
    assert.equal(await evaluate(`document.getElementById('${id}').getAttribute('aria-label')`), label);
    assert.ok(await evaluate(`Boolean(document.querySelector('label[for="${id}"]'))`));
    await evaluate(`document.getElementById('${id}').focus()`);
    await key("Tab", "Tab", 9);
    assert.equal(await evaluate("document.activeElement.className"), manager);
    await key("Enter", "Enter", 13);
    await waitFor(`document.querySelector('#settings-page-title')?.textContent === '${section}'`);
    await key("Escape", "Escape", 27);
    await waitFor("!document.querySelector('.settings-dialog')");
    assert.equal(await evaluate("document.activeElement.className"), manager);
  }
  console.log("PASS: keyboard navigation opens each management page and restores focus");
  await checkLayout(1480, 960, process.argv[3]);
  await checkLayout(920, 680, process.argv[4]);

  // DOM-only stress fixture: long names, both clear controls and both update badges.
  // Real selection/clear/update behavior remains covered by verify-skills and verify-knowledge.
  await evaluate(`document.querySelectorAll('.composer-context > div').forEach(group => {
    group.querySelector('select').selectedOptions[0].textContent = '用于测试长名称的选择项目'.repeat(8);
    const manager = group.querySelector('button');
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '×';
    const update = document.createElement('span'); update.className = 'skill-update'; update.textContent = '已更新';
    manager.before(clear, update);
  })`);
  await evaluate("document.querySelector('.model-trigger > span:nth-child(2)').textContent = '用于测试长名称的本地模型'.repeat(8)");
  await checkLayout(1480, 960);
  await checkLayout(920, 680);
  console.log("PASS: long names and simultaneous clear/update controls stay in one row");
} finally {
  await command("Emulation.clearDeviceMetricsOverride");
  if (isolated) await reload();
  close();
}
