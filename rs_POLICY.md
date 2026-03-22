Static DI (No Container): 実行時コンテナを捨て、Trait と Generics によるコンパイル時依存解決を徹底する。new の排除ではなく、new をコンパイル時点で静的に結合し、オーバーヘッドをゼロにする。

Type-Driven Development: テストでバグを探す前に、型システムで不正な状態を表現不能にする。 Enum (ADT) と Ownership を駆使し、実行するまでもなく「論理的に正しい」コードを組む。

Zero-Cost Generics: Rule of Threeに従い、共通化は Monomorphization（静的単一化）を前提とする。抽象化の代償としてパフォーマンスを1ミリも削らない。

Property-Based Testing: 100%のカバレッジに固執せず、proptest 等で境界条件を型から自動生成し、人間が思いつかないバグを機械に探させる。
