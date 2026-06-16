# 既知の制限

v8python は CPython 3.12 のコア言語と主要な標準ライブラリを実装している。
以下は簡略実装、または環境依存のため未実装である。

## 実装済みの構文・機能

旧版で未対応だったものを含め、以下はすべて実装済み:

- `bytes` / `bytearray`（`b'...'` リテラル、各種メソッド、`int.to_bytes` /
  `int.from_bytes`、`str.encode` / `bytes.decode`）
- `complex`（`1j` リテラル、四則演算、`complex()`、`.real` / `.imag` /
  `.conjugate()`、`abs()`）
- `match` / `case` 文（リテラル・キャプチャ・シーケンス・マッピング・クラス・
  OR・ガード・`as` パターン）
- `eval` / `exec` / `compile`
- ディスクリプタ（`__get__` / `__set__` / `__set_name__`）、`__getattribute__`、
  `__init_subclass__`
- メタクラス（`metaclass=`、`__new__` / `__init__`、メタクラスメソッド）
- `__slots__`（属性制限の強制）
- `async` / `await`、`async for`、`async with`（同期コルーチンモデル。下記参照）

## 簡略実装

- **並行処理（`async` / `asyncio` / `threading` / `multiprocessing`）**:
  単一コンテキストの同期評価器のため、これらは**同期モデル**で実装している。
  `asyncio.run` はコルーチンを即座に完走させ、`threading.Thread.start()` /
  `multiprocessing.Process.start()` はターゲットをその場で実行する。論理的な
  結果は CPython と一致するが、実際の並行・割り込み・タイミング依存の挙動は
  再現しない。
- **相対 import**: `from . import x` は構文解析され、親パッケージが無い場合は
  CPython と同じ `ImportError` を送出する。ディレクトリパッケージの解決は限定的。
- **再帰深度**: 既定 1000。深い再帰は `RecursionError`。
- **浮動小数フォーマット**: CPython 一致を目標に BigInt で正確な丸めを実装。
- **`random`**: PRNG は mulberry32。シード固定でも CPython とは別の乱数列。
- **`hash()` / `id()`**: 値は実装依存（dict/set の内部一貫性のみ保証）。
- **`re`**: JS `RegExp` に変換。名前付きグループ `(?P<>)`、`\A`/`\Z`、主要フラグ対応。
- **`decimal`**: 既定コンテキスト（精度28・ROUND_HALF_EVEN）の四則・比較・`quantize`。
- **`datetime`**: `date`/`time`/`datetime`/`timedelta`、`strftime`、`fromisoformat`。
  タイムゾーン (`tzinfo`) は非対応。
- **traceback**: ソース行表示と `^^^` キャレット装飾は再現しない。

## 標準ライブラリ

実装済み: `math`, `sys`, `time`, `random`, `functools`, `itertools`, `json`,
`collections`, `string`, `operator`, `heapq`, `bisect`, `copy`, `re`, `enum`,
`fractions`, `textwrap`, `pprint`, `datetime`, `decimal`, `os`（`os.path` 含む）,
`pathlib`, `asyncio`, `threading`, `multiprocessing`、および
`typing` / `__future__` のスタブ。

`collections` は `defaultdict` / `Counter`（算術演算 `+ - & |` 対応）/ `deque` /
`namedtuple`（`defaults=` 対応）/ `ChainMap` / `UserDict` / `UserList` を提供する。

未実装: `socket`, `sqlite3`, `urllib`, `subprocess` など、ネットワーク・DB・
外部プロセスといった**サンドボックス外のリソース**に依存するモジュール。これらは
JS サンドボックス内では忠実に実装できず、CPython の挙動も実行環境に依存するため
差分テストの対象外とする。
