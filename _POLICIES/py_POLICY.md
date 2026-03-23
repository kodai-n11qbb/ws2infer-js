
Dependency Injection: Protocol（構造的部分型）または ABC を使い、具象ではなく抽象に依存させる。注入には dependency_injector 等のライブラリで「newの排除」を強制する。

Rule of Three: Generic を活用し、3回繰り返されたロジックのみを型安全に共通化。

Refactor-ready Test: pytest と unittest.mock を呼吸するように使い、カバレッジ100%を維持。動的言語だからこそ、テストがないコードを「実行不能なゴミ」と定義する。
