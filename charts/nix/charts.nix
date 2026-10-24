{
  writeShellApplication,
  writeText,
  runCommand,
  nodejs_24,
  vl-convert,
  vazirmatn,
  python3,
  harfbuzz,
}:

let
  fonttools = python3.withPackages (ps: [
    ps.fonttools
    ps.brotli
  ]);

  # Vazirmatn is SIL Open Font License 1.1. These files measure text, and
  # render.mjs embeds a subset of the same files in each SVG.
  fontDir = runCommand "chart-fonts" { } ''
    mkdir -p "$out"
    cp ${vazirmatn}/share/fonts/truetype/Vazirmatn-Regular.ttf "$out/"
    cp ${vazirmatn}/share/fonts/truetype/Vazirmatn-Medium.ttf "$out/"
    cp ${vazirmatn}/share/fonts/truetype/Vazirmatn-SemiBold.ttf "$out/"
    cp ${vazirmatn}/share/fonts/truetype/Vazirmatn-Bold.ttf "$out/"
  '';

  fontConfig = writeText "charts-fonts.conf" ''
    <?xml version="1.0"?>
    <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
    <fontconfig>
      <dir>${fontDir}</dir>
      <cachedir>/tmp/abdolirad-chart-fontconfig</cachedir>
    </fontconfig>
  '';
in
writeShellApplication {
  name = "charts";
  runtimeInputs = [
    nodejs_24
    vl-convert
    fonttools
    # hb-shape lives in the dev output. SVG images ignore bidi isolates, so the
    # renderer measures each directional run and places it explicitly.
    harfbuzz.dev
  ];
  passthru = {
    inherit fontDir fontConfig;
  };
  text = ''
    export CHARTS_FONT_DIR=${fontDir}
    export FONTCONFIG_FILE=${fontConfig}
    exec node ${../render.mjs} "$@"
  '';
}
