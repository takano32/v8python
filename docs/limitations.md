# 既知の制限

v8python は CPython 3.12 のコア言語と主要な標準ライブラリを実装しているが、
以下は意図的に未実装、または簡略実装である。

## 未実装の構文・機能

- `async` / `await`、`async for`、`async with`（コルーチン・非同期I/O）
- `match` / `case` 文（構造的パターンマッチング）
- `bytes` / `bytearray` / `memoryview`（バイト列。`b'...'` リテラルは SyntaxError ではなく NotImplementedError）
- `complex`（複素数。`1j` リテラルは未対応）
- `eval` / `exec` / `compile`（動的コード実行）
- メタクラス（`metaclass=` キーワードは受理するが無視）
- `__slots__`
- スレッド・マルチプロセス（`threading`, `multiprocessing`, `asyncio`）
- 相対 import（`from . import x`）

## 簡略実装

- **再帰深度**: 既定 1000。深い再帰は `RecursionError`。CPython と異なり
  `sys.setrecursionlimit` は内部カウンタにのみ反映され、JS スタック上限とは独立。
- **浮動小数フォーマット**: `repr` と書式指定は CPython 一致を目標に BigInt で
  正確な丸めを実装しているが、`%g` / `.17g` など極端な桁の指数表記でごく稀に
  最終桁が異なる可能性がある。
- **`random`**: PRNG は mulberry32。シードを固定しても CPython（Mersenne
  Twister）とは異なる乱数列になる。統計的性質のみ互換。
- **`hash()` / `id()`**: 値は CPython と一致しない（実装依存）。`hash` は
  dict/set の内部キー一貫性のみ保証。
- **`math.gamma` / `lgamma`**: Lanczos 近似のため末尾数桁の誤差がある。
- **traceback**: 例外時のスタックトレースは出力するが、CPython 3.11+ が付与する
  ソース行表示と `^^^` キャレット装飾は再現しない。

## 標準ライブラリ

実装済み: `math`, `sys`, `time`, `random`, `functools`, `itertools`, `json`,
`collections`, `string`, `operator`、および `typing` / `__future__` のスタブ。

未実装（import すると `ModuleNotFoundError`）: `os`, `re`, `datetime`, `copy`,
`pathlib`, `decimal`, `fractions`, `heapq`, `bisect`, その他多数。
