# 差分テスト作成ガイドライン

CPython (`python3`) と v8python (`node python.js`) の出力を比較するテストを書く際の制約。
**テストケースを書く前に必ず読むこと。** 違反すると「実装は正しいのに FAIL する」偽陽性が出る。

## 1. 使用禁止の構文・機能（未実装）

- `async` / `await`、`match` 文
- `bytes` リテラル (`b'...'`)、`complex` (`1j`)
- `eval` / `exec` / `compile`
- `threading`、`multiprocessing`、`asyncio`
- `input()`（対話入力）、`open()`（ファイル系テスト以外）
- `__slots__`、メタクラス（`metaclass=`）
- 位置専用引数 `/` の細かい挙動に依存するテスト

## 2. 出力してはいけないもの（実装間で必ず異なる）

- `id()` / `hash()` の具体値
- デフォルト `repr`（`<... object at 0x...>` を含むもの）。`__repr__` を定義したオブジェクトのみ print 可
- **要素2個以上の set を直接 print するのは禁止**。CPython と要素の並び順が違う。
  必ず `print(sorted(s))` を使う。
- `frozenset` も同様に `sorted()` 経由で出力する
- `dict` の `keys()` / `values()` / `items()` ビューや dict 本体の print は**可**（挿入順で一致する）

## 3. random

- シードを固定しても実装（PRNG）が違うため**値は一致しない**
- 範囲・型・長さ・要素の所属などの**プロパティのみ**を検証する
- 例: `assert 1 <= random.randint(1, 6) <= 6` として、最後に `print("ok")` だけ出す

## 4. time

- 時刻・経過時間の**値を出力しない**（`time.time()` 等を print しない）
- `time.sleep()` は使ってよいが出力に影響させない

## 5. 例外メッセージ

- 基本は `except ... as e: print(type(e).__name__)` で**型名のみ**を出す
- `str(e)`（メッセージ本文）を出してよいのは、メッセージが安定している一般的な例外のみ:
  `KeyError`, `IndexError`, `ZeroDivisionError`, `ValueError`, `TypeError`（ただし文言が単純なもの）
- traceback 全体を出力に含めない（差分ランナーは stderr の例外型名しか比較しない）

## 6. 浮動小数

- `print(0.1 + 0.2)` などの repr 比較は**してよい**（実装は CPython 一致を目標にしている）
- `float('nan')`, `float('inf')` も可

## 7. 規模

- 再帰は深さ 100 程度まで（`RecursionError` を意図的に出す場合を除く）
- ループは 1e6 回程度まで
- 各テストファイルは **50 行以内・1 テーマ**

## 8. ファイル命名

- `機能_連番.py`（例: `str_methods_01.py`, `dict_basic_01.py`）
- ランナーは `tests/cases/*.py` を全て実行する。`print` を含まない補助モジュールは
  `cases/` に置かない（`import` されるだけの helper はテスト本体から相対 import しない設計にするか、
  内容を関数定義のみにして単独実行時に何も出力しないようにする）

## FAIL したときの対応（各テストタスク共通ルール）

1. 修正が **30行以内**で済むなら `src/` を直して再実行
2. それ以上の規模になりそうなら、**その場で直さず**:
   - 現象・最小再現コード・原因ファイル:行 を記録した新タスクを `TaskCreate` で作成
   - 該当ケースファイルを `tests/cases/` から `tests/pending/` へ移動
   - 自分のテストタスクは「作成したケースが全 PASS」状態にして完了させる
3. `ReferenceError` や `TypeError: X is not a function` は JS 実装のバグ。恐れず該当行を読む
