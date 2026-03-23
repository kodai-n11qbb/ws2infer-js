Explicit Dependency Wiring: DIコンテナを捨て、main で具象を new して手動で注入する。魔法を排除し、コードの「追いやすさ」のみを正義とする。

Interface as Consumer: 抽象を先に定義せず、使う側が最小限の interface を宣言する（Duck Typing）。「大きなインターフェースはインターフェースではない」。

Table-Driven Testing: struct のスライスで入力と期待値を羅列し、単一のループで全ケースを回す。カバレッジではなく、異常系の網羅に集中する。

Zero-Abstraction Logic: Generics による共通化を「早すぎる最適化」と断じ、コピペを恐れない。100行の抽象化より、10行の重複を選ぶ。
