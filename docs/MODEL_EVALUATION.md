# 울음 탐지 모델 비교 — 2026-10-03

## 운영 결정

현재 탐지 모델과 임계값을 유지한다. 더 큰 공식 YAMNet은 일부 울음을 추가로
감지했지만 고양이 소리 오탐과 다운로드 증가가 있어 기본 모델로 교체하지 않았다.
CNN은 전처리 재현을 검증할 자료가 부족하다. 필터 실험도 운영에서 분리했다.
이 결정은 기존 모델의 충분한 정확도를 인정한다는 뜻이 아니다.

## 고정한 비교 조건

- ESC-50 revision `33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6`.
- 추론 전 선택: crying_baby 40파일 전체, laughing/cat/dog/coughing/breathing/
  snoring/clock_alarm/vacuum_cleaner/washing_machine 각 파일명 정렬 첫 8개.
- 112파일, 파일별 0초 및 1.5초부터 3.072초 구간 = 224개 겹치는 구간.
- 모델 비교 입력: SciPy resample_poly로 16kHz 변환한 동일 구간.
- 기존 전처리와 동일한 보정/품질 기준. YAMNet 두 배포본 모두 15,600샘플씩
  세 프레임, 기존 `decideCry`와 같은 기준. 임계값을 결과에 맞춰 조정하지 않았다.
- 데이터셋의 파일 범주를 구간에도 적용했다. 각 구간의 울음 존재 여부를 별도로
  사람이 재라벨링하지 않았으므로 아래 수치를 임상/실사용 민감도로 해석하면 안 된다.

| 모델 / 실험 | 울음 범주 80구간의 감지 | 비울음 144구간의 울음 판정 | 결정 |
| --- | ---: | ---: | --- |
| 현재 MediaPipe YAMNet | 53 | 0 | 운영 유지 |
| Google 전체 YAMNet TFLite v1 (약 16.1MB) | 57 | 3 | 기본 모델 교체 보류 |
| compact CNN v0.2 잠정 재현 | 0 | 3 | 재현 불확실, 모델 성능 비교로 사용 불가 |

전체 YAMNet 추가 오탐은 고양이 녹음 `1-56380-A-5`의 두 구간과
`1-56380-B-5`의 1.5초 구간이다. 현재 모델 누락 구간과 상위 소리 분류,
파일 해시 및 전체 출처 목록은 `model-comparison-2026-10-03.json`에 기록했다.
현재 모델의 작은 표본(이전 2개 울음 파일)만으로 내린 추정과 확대 표본 결과는
차이가 크다. 이번 40개 파일도 아기/환경을 분리한 독립 검증을 대신하지 못한다.

## CNN 재현 제한

공개 metadata에는 preemphasis, FFT/window/hop, mel 범위, 정규화 통계가 있지만
STFT 스케일/중앙 정렬과 delta 계산의 완전한 참조 구현/입출력 벡터가 없다.
실험에서는 uncentered STFT, window-sum 정규화, numpy.gradient를 가정했다.
이 가정의 upstream parity를 확인하지 못했으므로 0/80을 CNN 품질의 결론으로
삼지 않는다. 추론은 로컬 ONNX Runtime에서만 수행했고 브라우저에 탑재하지 않았다.

## 전처리 별도 비교

동일한 **원본 44.1kHz** 파일을 기존 선형 리샘플링과 새 저역통과 필터에 입력했다.
이는 위의 이미 16kHz로 변환된 모델 비교와 입력 경로가 다르다.

| 전처리 | 울음 감지 / 80 | 비울음 오탐 / 144 |
| --- | ---: | ---: |
| 기존 선형 | 55 | 0 |
| 실험 필터 | 53 | 0 |

필터는 합성 12kHz 톤의 alias와 1kHz 통과대역 보존 시험을 통과했지만 실제 탐지
수가 감소했다. 따라서 `scripts/evaluation`에 격리했으며 운영 Worker는 가져오지
않는다. 원본별 결과는 `preprocessing-comparison-2026-10-03.json`.
`resampling-benchmark-2026-10-03.json`은 컨테이너의 특정 합성 톤 실험이며
휴대폰 성능이나 전체 주파수 응답/울음 정확도 측정이 아니다.

## 재현

Node 의존성과 배포 모델은 기존 `npm ci && npm run build`로 준비한다.
평가 음원/가중치/보고서는 저장소 밖 경로를 사용한다. Python 패키지는 선택적인
연구용이며 앱 dependency가 아니다.

```sh
python -m venv /tmp/eungaetalk-eval-venv
/tmp/eungaetalk-eval-venv/bin/pip install -r scripts/evaluation/requirements.txt
/tmp/eungaetalk-eval-venv/bin/python scripts/evaluation/prepare-esc50.py /tmp/eungaetalk-study
/tmp/eungaetalk-eval-venv/bin/python scripts/evaluation/download-candidates.py /tmp/eungaetalk-study
node scripts/diagnose-detector.cjs /tmp/eungaetalk-study/fixtures /tmp/eungaetalk-study/yamnet-expanded.json
node scripts/evaluation/compare-preprocessing.cjs /tmp/eungaetalk-study /tmp/eungaetalk-study/preprocessing.json
/tmp/eungaetalk-eval-venv/bin/python scripts/evaluation/compare-full-yamnet.py /tmp/eungaetalk-study
/tmp/eungaetalk-eval-venv/bin/python scripts/evaluation/compare-cnn-provisional.py /tmp/eungaetalk-study
```

## 남은 검증

말소리/음악/TV/아기 옹알이/혼합음과 실제 휴대폰 마이크 녹음, 독립 아기·기기·환경별
세트가 필요하다. 원인 라벨 정답은 없어 배고픔/트림 등의 정확도를 검증하지 못했다.
전체 모델의 추가 다운로드/브라우저 런타임 호환성은 운영 적용 전에 별도 확인해야 한다.
실기기 iPhone Safari/Android Chrome QA는 아직 수행하지 못했다.

## 출처

- [ESC-50 및 원본 라이선스](https://github.com/karolpiczak/ESC-50). 음원을 저장소/서비스에 재배포하지 않는다.
- [Google YAMNet TFLite](https://www.kaggle.com/models/google/yamnet/tfLite/tflite/1).
- [compact CNN v0.2](https://huggingface.co/manfye/baby-cry-detector/tree/4495440c7aeb0b04f12b9b991df5d92c062f92a0), CC-BY-SA-4.0 모델/문서.
