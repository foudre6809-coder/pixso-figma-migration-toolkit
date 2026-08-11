declare const pixso: any;
declare const __html__: string;

const frame = pixso.createFrame();
frame.name = "ACC_00_SMOKE";
frame.resize(100, 100);
pixso.currentPage.appendChild(frame);
pixso.currentPage.selection = [frame];
pixso.viewport.scrollAndZoomIntoView([frame]);

pixso.showUI(__html__, { width: 320, height: 120 });
pixso.ui.postMessage({
  type: "smoke-complete",
  node: {
    name: frame.name,
    type: frame.type,
    width: frame.width,
    height: frame.height
  }
});
