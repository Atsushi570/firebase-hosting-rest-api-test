/* eslint-disable no-console */
// https://hosting-test-c0336.web.app/

// node組み込みモジュールを読み込む
const fs = require('fs')
const crypto = require('crypto')
const zlib = require('zlib')
const path = require('path')
// const streams = require('memory-streams');

// npmパッケージを読み込む
const request = require('request')
const { JWT } = require('google-auth-library')

// googleのAPIからダウンロードしたサービスアカウントの認証情報を読み込む
// https://console.developers.google.com/
console.log(process.env.PROJECT_ID)
const keys = {
  site_name: process.env.PROJECT_ID,
  client_email: process.env.CLIENT_EMAIL,
  private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n')
}

// アップロードするファイルのsha256ハッシュ
const deployTargetPath = readdirRecursively(
  path.join(path.dirname(__dirname), 'public')
)[0]
const deployFile = zlib.gzipSync(fs.readFileSync(deployTargetPath))
const fileHash = crypto
  .createHash('sha256')
  .update(deployFile, 'utf8')
  .digest('hex')

/**
 * エントリーポイント
 */
async function main() {
  let proc = 1

  // API リクエストを認証して承認するためのaccess tokenを取得する
  const accessToken = await getAccessToken()
  console.log(
    `proc${proc++} getAccessToken finish ! access token:${accessToken}`
  )

  // 最後にreleasesされたサイトのversionNameを取得する
  const latestVersion = await getLatestVersionName(accessToken)
  console.log(
    `proc${proc++} getLatestVersionName finish ! latest version name:${latestVersion}`
  )

  // versionNameで指定したversionのファイル構成を取得する
  const latestDeployedFiles = await getVersionFiles(accessToken, latestVersion)
  console.log(
    `proc${proc++} getVersionFiles finish ! files:${
      latestDeployedFiles.files.length
    }`
  )

  // サイトの新しいバージョンを作成する
  const createdVersionName = await createSiteVersion(accessToken)
  console.log(
    `proc${proc++} createSiteVersion finish !  version name:${createdVersionName}`
  )

  // デプロイするファイルのリストを指定してアップロード先のURLを取得する
  const uploadURL = await setTargetFiles(accessToken, createdVersionName)
  console.log(`proc${proc++} setTargetFiles finish ! uploadURL:${uploadURL}`)

  // 必要なファイルをアップロードする
  const responseUploadFiles = await uploadFiles(
    accessToken,
    uploadURL,
    deployTargetPath
  )
  console.log(
    `proc${proc++} uploadFiles finish ! response status:${
      responseUploadFiles.statusCode
    }`
  )

  // バージョンのステータスを FINALIZED に更新する
  const responseFinalize = await finalizeStatus(accessToken, createdVersionName)
  console.log(
    `proc${proc++} finalizeStatus finish ! response status:${
      responseFinalize.statusCode
    }`
  )

  // デプロイ用にバージョンをリリースする
  const responseCallDeploy = await callDeploy(accessToken, createdVersionName)
  console.log(
    `proc${proc++} callDeploy finish ! response status:${
      responseCallDeploy.statusCode
    }`
  )
}

main().catch(console.error)

/**
 * 指定したディレクトリ配下に存在するファイルのパスを再帰的に取得してリストで返却する
 * @param {string} dir 探索対象のディレクトリパス
 */
function readdirRecursively(dir) {
  let files = []
  const dirents = fs.readdirSync(dir, { withFileTypes: true })
  const dirs = []
  for (const dirent of dirents) {
    if (dirent.isDirectory()) dirs.push(`${dir}/${dirent.name}`)
    if (dirent.isFile()) files.push(`${dir}/${dirent.name}`)
  }
  for (const d of dirs) {
    files = readdirRecursively(d, files)
  }
  return files
}

/**
 * API リクエストを認証して承認するためのアクセス トークンを取得する
 * OAuth2.0クライアントを生成してaccessTokenを取得する
 * keysに認証情報が格納されている必要がある
 * サーバ上で完結するためにはJWTでのToken取得に書き換えなければならない
 */
async function getAccessToken() {
  const client = new JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/firebase'],
    null
  )
  console.log(keys.client_email.slice(0, -2))
  console.log(keys.private_key.slice(0, -2))
  const result = await client.authorize().catch(console.error())
  return result.access_token
}

/**
 * 指定されたサイトで作成されているリリース情報を取得する
 * クエリパラメータpageSize=1を指定しているため最新のリリース情報のみ取得する
 */
function getLatestVersionName(accessToken) {
  return new Promise((resolve) => {
    function callback(error, response, body) {
      if (!error && response.statusCode === 200) {
        resolve(JSON.parse(body).releases[0].version.name)
      } else {
        console.log(`error occurred at getLatestVersionName: ${error}`)
      }
    }

    const options = {
      url:
        'https://firebasehosting.googleapis.com/v1beta1/sites/hosting-test-c0336/releases?pageSize=1',
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken
      }
    }
    request(options, callback)
  })
}

/**
 * 指定したバージョンのファイル構成を取得する
 */
function getVersionFiles(accessToken, latestVersion) {
  return new Promise((resolve) => {
    function callback(error, response, body) {
      if (!error && response.statusCode === 200) {
        resolve(JSON.parse(body))
      } else {
        console.log(`error occurred at getVersionFiles: ${error}`)
      }
    }

    const options = {
      url: `https://firebasehosting.googleapis.com/v1beta1/${latestVersion}/files`,
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken
      }
    }
    request(options, callback)
  })
}

/**
 * サイトの新しいバージョンを作成する
 */
function createSiteVersion(accessToken) {
  return new Promise((resolve) => {
    function callback(error, response, body) {
      if (!error && response.statusCode === 200) {
        resolve(body.name)
      } else {
        console.log(`error occurred at createSiteVersion: ${error}`)
      }
    }

    const options = {
      url:
        'https://firebasehosting.googleapis.com/v1beta1/sites/hosting-test-c0336/versions',
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        Authorization: 'Bearer ' + accessToken
      },
      json: {
        config: {
          headers: [
            {
              glob: '**',
              headers: {
                'Cache-Control': 'max-age=1800'
              }
            }
          ]
        }
      }
    }
    request(options, callback)
  })
}

/**
 * デプロイするファイルのリストを指定してアップロード先のURLを取得する
 * 事前にデプロイするファイルをgzipしておく
 */
function setTargetFiles(accessToken, versionId) {
  return new Promise((resolve) => {
    function callback(error, response, body) {
      if (!error && response.statusCode === 200) {
        resolve(body.uploadUrl)
      } else {
        console.log(`error occurred at setTargetFiles: ${response.body}`)
      }
    }

    const options = {
      url:
        'https://firebasehosting.googleapis.com/v1beta1/' +
        versionId +
        ':populateFiles',
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        Authorization: 'Bearer ' + accessToken
      },
      json: {
        files: {
          '/404.html': fileHash
        }
      }
    }
    request(options, callback)
  })
}

/**
 * 必要なファイルをアップロードする
 * 取得したuploadUrlにアップロードするファイルハッシュを追加してgzをアップロードする
 */
function uploadFiles(accessToken, uploadUrl) {
  return new Promise((resolve) => {
    function callback(error, response) {
      if (!error && response.statusCode === 200) {
        resolve(response)
      } else {
        console.log(`error occurred at uploadFiles: ${response}`)
      }
    }

    const data = deployFile
    const options = {
      url: uploadUrl + '/' + fileHash,
      method: 'POST',
      headers: {
        'Content-type': 'application/octet-stream',
        Authorization: 'Bearer ' + accessToken,
        'Content-Length': data.length
      },
      body: data
    }
    request(options, callback)
  })
}

/**
 * バージョンのステータスを FINALIZED に更新する
 */
function finalizeStatus(accessToken, versionId) {
  return new Promise((resolve) => {
    function callback(error, response) {
      if (!error && response.statusCode === 200) {
        resolve(response)
      } else {
        console.log(`error occurred at finalizeStatus: ${response.body}`)
      }
    }

    const options = {
      url:
        'https://firebasehosting.googleapis.com/v1beta1/' +
        versionId +
        '?update_mask=status',
      method: 'PATCH',
      headers: {
        'Content-type': 'application/json',
        Authorization: 'Bearer ' + accessToken
      },
      body: JSON.stringify({ status: 'FINALIZED' })
    }
    request(options, callback)
  })
}

/**
 * デプロイ用にバージョンをリリースする
 */
function callDeploy(accessToken, versionId) {
  return new Promise((resolve) => {
    function callback(error, response) {
      if (!error && response.statusCode === 200) {
        resolve(response)
      } else {
        console.log(`error occurred at callDeploy: ${response.body}`)
      }
    }

    const options = {
      url: `https://firebasehosting.googleapis.com/v1beta1/sites/${keys.site_name}/releases?versionName=${versionId}`,
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken
      }
    }
    request(options, callback)
  })
}
