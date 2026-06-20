# v8python

**V8（Node.js）上で動く Python 3 処理系**。純粋な JavaScript・依存ゼロで実装した
Python インタプリタです。字句解析 → 再帰下降パーサ → JS ジェネレータベースの
ツリーウォーク評価器、という構成になっています。

```
$ ./v8python fib.py
$ ./v8python          # 対話 REPL
```

## インストール

```bash
# npm からグローバルインストール
npm install -g v8python
v8python script.py

# あるいは npx で都度実行
npx v8python script.py
```

## 使い方

```bash
# スクリプトを実行（リポジトリを clone した場合）
./v8python script.py [引数...]

# 対話モード（REPL）
./v8python

# CPython との差分テスト（python3 が必要）
node tests/run_tests.js          # 全件
node tests/run_tests.js dict     # ファイル名に "dict" を含むケースのみ
```

Node.js 18 以降を想定（BigInt・`structuredClone` 不使用・ESM）。

## 対応している機能

- **データ型**: 任意精度整数（BigInt）、浮動小数、文字列（コードポイント単位）、
  bool、None、list、tuple、dict（挿入順保持）、set / frozenset、range、slice、bytes は非対応
- **制御構文**: if/elif/else、for/while（else 節つき）、break/continue、with、
  try/except/else/finally、raise（from つき）、assert、del、global/nonlocal
- **関数**: デフォルト引数、`*args` / `**kwargs`、キーワード専用引数、位置専用引数、
  クロージャ、`nonlocal`、デコレータ、ラムダ、再帰
- **クラス**: 単一・多重継承（**C3 線形化による MRO**）、`super()`、
  演算子オーバーロード（`__add__` / `__radd__` / `__eq__` / `__lt__` / `__getitem__` …）、
  `property`、`classmethod` / `staticmethod`、`__iter__` / `__next__`、
  カスタム `__hash__` / `__eq__`、`isinstance` / `issubclass`
- **ジェネレータ**: `yield`、`yield from`、`send` / `throw` / `close`、
  ジェネレータ式、return 値（`StopIteration.value`）
- **内包表記**: list / dict / set 内包、ネスト、条件つき、独立スコープ
- **文字列整形**: f-string（`{x:.2f}`、`{x!r}`、ネスト指定 `{v:{w}.{p}f}`、
  自己文書化 `{x=}`）、`str.format`、`%` 演算子
- **標準ライブラリ**: `math` / `sys` / `time` / `random` / `functools` /
  `itertools` / `json` / `collections` / `string` / `operator`
  （`typing` / `__future__` はスタブ）
- **ファイル import**: スクリプトと同じディレクトリの `.py` を `import` 可能

未対応の機能は [docs/limitations.md](docs/limitations.md) を参照してください。

## アーキテクチャ

```
src/lexer.js     字句解析。インデントを INDENT/DEDENT トークンに変換し、
                 括弧内の暗黙の行継続、f-string の構造解析を行う。
src/parser.js    再帰下降パーサで AST を構築し、続くスコープ解析パスで
                 各関数・ラムダ・内包表記の local / global / nonlocal を確定する。
src/objects.js   オブジェクトモデル。型システム（C3 MRO）、属性アクセス、
                 演算子ディスパッチ、ハッシュ／等価、反復、repr/str を実装。
src/fmt.js       CPython 互換の浮動小数フォーマット。IEEE-754 ビットを BigInt で
                 取り出し、正確な十進スケーリングで偶数丸めを行う。
src/builtins.js  組み込み関数と、str/list/dict/set 等のメソッドテーブル。
src/interp.js    ツリーウォーク評価器。yield を実現するため、すべての評価関数を
                 JS ジェネレータ関数として書いている。
src/stdlib.js    標準ライブラリモジュール群。
src/repl.js      対話 REPL（複数行ブロック入力・式結果の repr 表示）。
src/cli.js       CLI エントリ。ファイル実行・traceback 整形・stdin/stdout/fs 接続。
v8python         実行ランチャ（bash）。src/cli.js を node で起動するだけのラッパ。
```

## 設計上の面白い点

- **Python の `int` を JS の `BigInt` で表現** — `2 ** 100` のような任意精度演算が
  そのまま動く。`float` は通常の JS number。
- **`dict` は挿入順を保持** — JS の `Map` をハッシュバケットに使い、値ベースの
  等価（`1`、`1.0`、`True` を同一キーとして扱う）を実装。
- **`yield` を「すべての評価関数を JS ジェネレータにする」ことで実現** — Python の
  `yield` はどんな式の途中でも値を外へ送出できる。これを、評価器の `evalExpr` /
  `execStmt` 等を `function*` にし、`yield*` のチェーンで値を `PyGenerator` まで
  伝播させることで自然に表現している。JS から Python コードを呼ぶ箇所（dunder の
  呼び出しなど）はジェネレータを同期的に駆動する。
- **浮動小数の repr が CPython と一致** — `0.1 + 0.2` が `0.30000000000000004` に
  なるところまで、IEEE-754 の正確な十進展開と round-half-even で再現している。

## テスト

`tests/cases/*.py` の各ファイルを CPython（`python3`）と v8python の両方で実行し、
標準出力と例外型を比較しています（136 ケースが完全一致）。新しいテストを書く際は
[tests/GUIDELINES.md](tests/GUIDELINES.md) の制約（set の出力順、random の値比較禁止
など）を参照してください。
