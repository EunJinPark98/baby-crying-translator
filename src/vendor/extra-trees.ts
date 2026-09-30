import FFT from "fft.js";

const MAGIC = "LLTREE01";
const MEL_BINS = 64;
const FFT_SIZE = 512;
const FRAME_SIZE = 400;
const FRAME_HOP = 160;
const CLASS_COUNT = 6;

type BrowserTree = {
  left: Int32Array;
  right: Int32Array;
  feature: Int16Array;
  threshold: Float64Array;
  probabilities: Float32Array;
};

export type ExtraTreesBundle = {
  version: number;
  featureCount: number;
  classCount: number;
  trees: BrowserTree[];
};

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

function melFilters(): Float64Array[] {
  const points = Array.from({ length: MEL_BINS + 2 }, (_, index) => {
    const ratio = index / (MEL_BINS + 1);
    return melToHz(hzToMel(50) + ratio * (hzToMel(8_000) - hzToMel(50)));
  });
  return Array.from({ length: MEL_BINS }, (_, mel) => {
    const [left, center, right] = points.slice(mel, mel + 3);
    return Float64Array.from({ length: FFT_SIZE / 2 + 1 }, (_, bin) => {
      const frequency = bin * 8_000 / 256;
      return Math.max(0, Math.min(
        (frequency - left) / (center - left),
        (right - frequency) / (right - center),
      ));
    });
  });
}

const FILTERS = melFilters();
const HANN = Float64Array.from(
  { length: FRAME_SIZE },
  (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / FRAME_SIZE),
);
const WINDOW_SUM = HANN.reduce((sum, value) => sum + value, 0);

function meansAndStandardDeviations(values: Float64Array, rows: number, columns: number): Float64Array {
  const output = new Float64Array(rows * 2);
  for (let row = 0; row < rows; row += 1) {
    let mean = 0;
    for (let column = 0; column < columns; column += 1) mean += values[row * columns + column];
    mean /= columns;
    let variance = 0;
    for (let column = 0; column < columns; column += 1) {
      const difference = values[row * columns + column] - mean;
      variance += difference * difference;
    }
    output[row] = mean;
    output[rows + row] = Math.sqrt(variance / columns);
  }
  return output;
}

function gradient(values: Float64Array, rows: number, columns: number): Float64Array {
  const output = new Float64Array(values.length);
  for (let row = 0; row < rows; row += 1) {
    const offset = row * columns;
    output[offset] = values[offset + 1] - values[offset];
    for (let column = 1; column < columns - 1; column += 1) {
      output[offset + column] = 0.5 * (values[offset + column + 1] - values[offset + column - 1]);
    }
    output[offset + columns - 1] = values[offset + columns - 1] - values[offset + columns - 2];
  }
  return output;
}

function dctMfcc(logMel: Float64Array, frames: number): Float64Array {
  const output = new Float64Array(13 * frames);
  for (let coefficient = 0; coefficient < 13; coefficient += 1) {
    const scale = coefficient === 0 ? Math.sqrt(1 / MEL_BINS) : Math.sqrt(2 / MEL_BINS);
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      for (let mel = 0; mel < MEL_BINS; mel += 1) {
        sum += logMel[mel * frames + frame]
          * Math.cos(Math.PI / MEL_BINS * (mel + 0.5) * coefficient);
      }
      output[coefficient * frames + frame] = scale * sum;
    }
  }
  return output;
}

export function extractClassicalFeatures(waveform: Float32Array): Float64Array {
  if (waveform.length < FRAME_SIZE) throw new Error("The normalized clip is too short for acoustic features.");
  const frames = Math.floor((waveform.length - FRAME_SIZE) / FRAME_HOP) + 1;
  const logMel = new Float64Array(MEL_BINS * frames);
  const centroid = new Float64Array(frames);
  const bandwidth = new Float64Array(frames);
  const rolloff = new Float64Array(frames);
  const flatness = new Float64Array(frames);
  const rms = new Float64Array(frames);
  const fft = new FFT(FFT_SIZE);
  const input = new Float64Array(FFT_SIZE);
  const spectrum = fft.createComplexArray();
  const power = new Float64Array(FFT_SIZE / 2 + 1);

  for (let frame = 0; frame < frames; frame += 1) {
    input.fill(0);
    const start = frame * FRAME_HOP;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      input[index] = waveform[start + index] * HANN[index];
    }
    fft.realTransform(spectrum, input);
    let powerTotal = 0;
    let logPowerTotal = 0;
    let weightedFrequency = 0;
    for (let bin = 0; bin <= FFT_SIZE / 2; bin += 1) {
      const real = spectrum[2 * bin] / WINDOW_SUM;
      const imaginary = spectrum[2 * bin + 1] / WINDOW_SUM;
      const value = Math.max(real * real + imaginary * imaginary, 1e-12);
      power[bin] = value;
      powerTotal += value;
      logPowerTotal += Math.log(value);
      weightedFrequency += bin * (8_000 / 256) * value;
    }
    centroid[frame] = weightedFrequency / powerTotal;
    let spread = 0;
    let cumulative = 0;
    let rolloffBin = 0;
    for (let bin = 0; bin <= FFT_SIZE / 2; bin += 1) {
      const frequency = bin * (8_000 / 256);
      spread += (frequency - centroid[frame]) ** 2 * power[bin];
      cumulative += power[bin];
      if (rolloffBin === 0 && cumulative >= 0.85 * powerTotal) rolloffBin = bin;
    }
    bandwidth[frame] = Math.sqrt(spread / powerTotal);
    rolloff[frame] = rolloffBin * (8_000 / 256);
    flatness[frame] = Math.exp(logPowerTotal / power.length) / (powerTotal / power.length);
    rms[frame] = Math.sqrt(powerTotal / power.length);
    for (let mel = 0; mel < MEL_BINS; mel += 1) {
      let energy = 0;
      for (let bin = 0; bin <= FFT_SIZE / 2; bin += 1) energy += FILTERS[mel][bin] * power[bin];
      logMel[mel * frames + frame] = Math.log(Math.max(energy, 1e-6));
    }
  }

  const mfcc = dctMfcc(logMel, frames);
  const firstDelta = gradient(mfcc, 13, frames);
  const secondDelta = gradient(firstDelta, 13, frames);
  const blocks = [
    meansAndStandardDeviations(logMel, MEL_BINS, frames),
    meansAndStandardDeviations(mfcc, 13, frames),
    meansAndStandardDeviations(firstDelta, 13, frames),
    meansAndStandardDeviations(secondDelta, 13, frames),
  ];
  const features = new Float64Array(217);
  let cursor = 0;
  for (const block of blocks) {
    features.set(block, cursor);
    cursor += block.length;
  }
  const scalarRows = [centroid, bandwidth, rolloff, flatness, rms];
  for (const row of scalarRows) {
    const pair = meansAndStandardDeviations(row, 1, frames);
    features[cursor] = pair[0];
    features[cursor + 1] = pair[1];
    cursor += 2;
  }
  let crossings = 0;
  for (let index = 1; index < waveform.length; index += 1) {
    if ((waveform[index] < 0) !== (waveform[index - 1] < 0)) crossings += 1;
  }
  features[cursor] = crossings / (waveform.length - 1);
  return features;
}

export function parseExtraTreesBundle(buffer: ArrayBuffer): ExtraTreesBundle {
  const view = new DataView(buffer);
  let offset = 0;
  const magic = String.fromCharCode(...new Uint8Array(buffer, offset, MAGIC.length));
  offset += MAGIC.length;
  if (magic !== MAGIC) throw new Error("The reason model bundle has an invalid signature.");
  const version = view.getUint32(offset, true); offset += 4;
  const treeCount = view.getUint32(offset, true); offset += 4;
  const featureCount = view.getUint32(offset, true); offset += 4;
  const classCount = view.getUint32(offset, true); offset += 4;
  if (version !== 1 || featureCount !== 217 || classCount !== CLASS_COUNT) {
    throw new Error("The reason model bundle uses an unsupported contract.");
  }
  const trees: BrowserTree[] = [];
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    const nodeCount = view.getUint32(offset, true); offset += 4;
    const tree: BrowserTree = {
      left: new Int32Array(nodeCount),
      right: new Int32Array(nodeCount),
      feature: new Int16Array(nodeCount),
      threshold: new Float64Array(nodeCount),
      probabilities: new Float32Array(nodeCount * classCount),
    };
    for (let node = 0; node < nodeCount; node += 1) {
      tree.left[node] = view.getInt32(offset, true); offset += 4;
      tree.right[node] = view.getInt32(offset, true); offset += 4;
      tree.feature[node] = view.getInt16(offset, true); offset += 2;
      tree.threshold[node] = view.getFloat64(offset, true); offset += 8;
      for (let label = 0; label < classCount; label += 1) {
        tree.probabilities[node * classCount + label] = view.getFloat32(offset, true);
        offset += 4;
      }
    }
    trees.push(tree);
  }
  if (offset !== buffer.byteLength) throw new Error("The reason model bundle has trailing or incomplete data.");
  return { version, featureCount, classCount, trees };
}

export function predictExtraTrees(bundle: ExtraTreesBundle, features: Float64Array): number[] {
  if (features.length !== bundle.featureCount) throw new Error("Reason feature count does not match the model.");
  const probabilities = new Array(bundle.classCount).fill(0);
  for (const tree of bundle.trees) {
    let node = 0;
    while (tree.feature[node] >= 0) {
      node = features[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
    }
    for (let label = 0; label < bundle.classCount; label += 1) {
      probabilities[label] += tree.probabilities[node * bundle.classCount + label] / bundle.trees.length;
    }
  }
  return probabilities;
}
