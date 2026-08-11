declare const pixso: any;
declare const __html__: string;

const containerFields = [
  "type",
  "x",
  "y",
  "width",
  "height",
  "layoutMode",
  "layoutWrap",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "itemSpacing"
] as const;

const childFields = [
  "type",
  "x",
  "y",
  "width",
  "height",
  "layoutAlign",
  "layoutGrow",
  "layoutPositioning",
  "layoutSizingHorizontal",
  "layoutSizingVertical"
] as const;

interface FieldValue {
  available: boolean;
  value: string | number | boolean | null;
}

function readField(node: any, field: string): FieldValue {
  try {
    const value = node[field];
    const primitive = value === null || ["string", "number", "boolean"].includes(typeof value);
    return {
      available: field in node && value !== undefined && primitive,
      value: primitive ? value : null
    };
  } catch {
    return { available: false, value: null };
  }
}

function readFields(node: any, fields: readonly string[]): Record<string, FieldValue> {
  return Object.fromEntries(fields.map((field) => [field, readField(node, field)]));
}

function collectReport(): Record<string, unknown> {
  const pageChildren = Array.isArray(pixso?.currentPage?.children) ? pixso.currentPage.children : [];
  const samples = pageChildren
    .filter((node: any) => typeof node?.name === "string" && node.name.startsWith("AL_"))
    .map((node: any) => ({
      name: node.name,
      raw: readFields(node, containerFields),
      children: (Array.isArray(node.children) ? node.children : []).map((child: any) => ({
        name: String(child.name ?? "Unnamed"),
        raw: readFields(child, childFields)
      }))
    }));

  return {
    reportVersion: 1,
    sourceTool: "pixso-plugin-api",
    sourceEnvironment: {
      pluginApiVersion: pixso?.apiVersion ?? null,
      fileName: pixso?.root?.name ?? null
    },
    expectedSamplePrefix: "AL_",
    sampleCount: samples.length,
    samples
  };
}

pixso?.showUI?.(__html__, { width: 420, height: 240 });

function sendReport(): void {
  try {
    pixso?.ui?.postMessage?.({
      type: "download-json",
      name: "pixso-layout-probe.json",
      data: collectReport()
    });
  } catch (error) {
    pixso?.ui?.postMessage?.({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

pixso.ui.onmessage = (message: { type?: string }) => {
  if (message.type === "export") sendReport();
};

setTimeout(sendReport, 500);
