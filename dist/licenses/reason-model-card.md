---
pipeline_tag: audio-classification
tags:
  - baby-cry
  - audio-classification
  - extra-trees
  - browser
license: cc-by-sa-4.0
---

# Baby Cry Reasoning classifier v0.6

Experimental Extra Trees classifier over 217 acoustic features. It predicts six dataset labels: `belly_pain`, `burping`, `discomfort`, `hungry`, `lonely`, and `scared`. These are dataset annotations, not diagnoses or dependable explanations of an individual baby's needs.

## Audio contract

- mono, 16 kHz
- 49,152 samples / 3.072 seconds
- 217 deterministic features
- 1,000 trees, minimum leaf size 4
- browser runtime: `runtime/extra-trees.ts`

## Development evaluation

v0.6 scored 62.34% accuracy, 59.82% balanced accuracy, and 62.61% macro-F1 on a reused 154-file development-validation partition after data-quality filtering. There is no untouched compatible final holdout.

## Use and limitations

For training and testing only. Do not use for diagnosis, infant monitoring, or caregiving decisions.

## License

The model artifact, browser runtime, and repository-authored documentation are released under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0). No training audio is included. This license does not relicense third-party datasets; their original terms and unresolved lineage still apply.
