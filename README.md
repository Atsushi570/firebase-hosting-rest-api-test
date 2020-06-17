## 概要
- Firebase HostingのREST APIを叩いて新規にStorybookを追加するためのNode.js上で動くスクリプト
- まずは最小構成で試してみるため、個人のアカウントでプロジェクトを作成、APIや認証の有効化などして実験用の環境で検証中
- 8回APIを叩いている
- CircleCIのconfig.ymlでスクリプトをrunするイメージ

***
## 手順
### proc.1 google apis を使用するためのaccess tokenを取得する
#### 現状
- APIを叩くためのaccess tokenを取得する
- 認証はJWTを利用している
#### 今後
- JWTによる認証に変更してCircleCIで動作可能にする
  - 本番アカウントでのgoogle apisのサービスアカウント作成とキーの入手する
  - キーをもとにJWTの作成してCircleCIで使えるようにする（環境変数に設定？）
#### 参考
- [jwtで認証してAPIを叩く](https://christina04.hatenablog.com/entry/2015/06/04/224159)

***

### proc.2 最後にreleasesされたサイトのversionNameを取得する
#### 概況
- 現在デプロイされているサイトのversionを取得する
- この情報があると現在デプロイされているサイトのファイル構成を取得できるようになる
- 特に問題無し

*** 

### proc.3 versionNameで指定したversionのファイル構成を取得する
#### 現状
- 現在デプロイされているサイトのファイル構成を取得する
- 既存のファイルを保持したまま、サイトに新しいStorybookを追加する際、この情報が必要になる
- 現状の実装ではファイル構成が1000を超えると一度のリクエストでは情報を取得しきれない
#### 今後
- ファイル構成が1000を超えることを想定した実装にする？

*** 

### proc.4 サイトの新しいバージョンを作成する
#### 現状
- 新しいファイルをサイトに追加するために新しいバージョンを作る
- 返送されたバージョン情報をもとにデプロイをするためのAPIを叩いていく
- 特に問題なし

*** 

### proc.5 デプロイするファイルのリストを指定してアップロード先のURLを取得する
#### 現状
- proc.4で取得したバージョンのサイトをリリースするにあたってアップロードが必要なファイル情報を取得する
- proc.3で取得した既存サイトにデプロイされているファイルと新規で追加するファイル情報をjsonにしてPOSTすると上記情報が返送される
- デプロイするときのファイルパスとファイルをgzipにしたときのSHA-256ハッシュ値が必要
- スクリプト内で指定されたファイルをzlibでgzipにしている
- 現在は手動でファイルリストを作成している
#### 今後
- ファイルリストを作成する仕様を追加する

*** 

### proc.6 必要なファイルをアップロードする
#### 現状
- proc.5で取得したファイルリストを元にgzipにしたファイルをPOSTする
- 現在は手動でPOSTするファイルを一つ選択している
#### 今後
- 必要なファイルを全てPOSTする仕様を追加する

*** 

### proc.7 バージョンのステータスを FINALIZED に更新する
#### 現状
- 作成したサイトのバージョンをCREATEDからFINALIZEDに更新する
- 特に問題なし

*** 

### proc.8 デプロイ用にバージョンをリリースする
#### 現状
- 作成したサイトのバージョンをリリースする
- 特に問題なし



