# Image-processing fixtures

Put real, full-resolution target captures here for repeatable desktop detection experiments. The harness never uploads them.

For one sequence, use:

```text
test_assets/
  baseline.jpg       # clean target or reset reference
  shot1.jpg          # first capture after baseline
  shot2.jpg          # next capture, and so on
```

For multiple cameras, lighting conditions, or target types, give each scenario a directory and keep the same names:

```text
test_assets/
  paper-overcast-100yd/
    baseline.jpg
    shot1.jpg
    shot2.jpg
  steel-sun-300yd/
    baseline.jpg
    shot1.jpg
```

Capture guidelines:

- Keep the original resolution and EXIF orientation; the loader auto-orients before analysis.
- Avoid editing or resaving only one image in a pair, which introduces unrelated compression changes.
- Record an expected coordinate in a neighboring optional file such as `shot1.expected.json` when turning a pair into an automated regression fixture.
- Remove GPS/identifying metadata before committing range photos.
- A target replacement or repaint starts a new scenario/baseline rather than continuing the old sequence.

Example run:

```powershell
npx tsx tools/image-harness/cli.ts `
  test_assets/paper-overcast-100yd/baseline.jpg `
  test_assets/paper-overcast-100yd/shot1.jpg `
  --debug-dir .local/paper-overcast-100yd
```

