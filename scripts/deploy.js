/* eslint-disable no-console */
// https://hosting-test-c0336.web.app/

// node組み込みモジュールを読み込む
const fs = require('fs')
const crypto = require('crypto')
const zlib = require('zlib')
const path = require('path')

// npmパッケージを読み込む
const request = require('request')
const { JWT } = require('google-auth-library')

// googleのAPIからダウンロードしたサービスアカウントの認証情報を読み込む
// https://console.developers.google.com/
// const keys = require('./jwt.keys.json') // localでの検証用
// keys.site_name = keys.project_id // localでの検証用
const keys = {
  site_name: process.env.PROJECT_ID,
  client_email: process.env.CLIENT_EMAIL,
  private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n') // replaceしないとtokenを取得できない
}

// 指定したディレクトリにあるファイルを再帰的に読み込み、ファイルパスのリストを作成する
const readdirRecursively = (dir, files = []) => {
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
const storybookDirectoryPath = path.join(
  path.dirname(__dirname),
  'storybook-static'
)
const deployTargetPaths = readdirRecursively(storybookDirectoryPath)

// アップロードするファイルオブジェクトのリストを作成する
const deployFiles = []
for (const key of Object.keys(deployTargetPaths)) {
  const binaryData = zlib.gzipSync(fs.readFileSync(deployTargetPaths[key]))
  deployFiles.push({
    path: `${process.env.$CIRCLE_BRANCH}/${deployTargetPaths[key].replace(
      storybookDirectoryPath,
      ''
    )}`,
    // path: '/test1' + deployTargetPaths[key].replace(storybookDirectoryPath, ''), // localでの検証用
    binaryData,
    hash: crypto
      .createHash('sha256')
      .update(binaryData, 'utf8')
      .digest('hex')
  })
}

/**
 * エントリーポイント
 */
async function main() {
  let proc = 1

  // API リクエストを認証して承認するためのaccess tokenを取得する
  const accessToken = await getAccessToken()
  console.log(`proc${proc++} getAccessToken finish !`)

  // 最後にreleasesされたサイトのversionNameを取得する
  const latestVersion = await getLatestVersionName(accessToken)
  console.log(
    `proc${proc++} getLatestVersionName finish ! latest version name:${latestVersion}`
  )

  // versionNameで指定したversionのファイル構成を取得する
  const latestDeployedFiles = await getVersionFiles(accessToken, latestVersion)
  console.log(
    `proc${proc++} getVersionFiles finish ! current number of deployed files:${
      latestDeployedFiles.files.length
    }`
  )

  // deployFilesに現在hostされているファイル情報を追加する
  for (const file of latestDeployedFiles.files) {
    if (!deployFiles.some((deployFile) => deployFile.path === file.path)) {
      deployFiles.push({
        path: file.path,
        hash: file.hash
      })
    }
  }

  // サイトの新しいバージョンを作成する
  const createdVersionName = await createSiteVersion(accessToken)
  console.log(
    `proc${proc++} createSiteVersion finish !  version name:${createdVersionName}`
  )

  // デプロイするファイルのリストを指定してアップロード先のURLの取得とデプロイするファイル構成を指定する
  const { uploadUrl, uploadRequiredHashes } = await setTargetFiles(
    accessToken,
    createdVersionName,
    deployFiles
  )
  if (uploadRequiredHashes) {
    console.log(
      `proc${proc++} setTargetFiles finish ! Number of files that need to be uploaded:${
        uploadRequiredHashes.length
      }`
    )
  } else {
    console.log(`proc${proc++} no file is specified to upload`)
  }

  // 必要なファイルをアップロードする
  if (uploadRequiredHashes) {
    for (const key of Object.keys(deployFiles)) {
      if (uploadRequiredHashes.includes(deployFiles[key].hash)) {
        const responseUploadFiles = await uploadFiles(
          accessToken,
          uploadUrl,
          deployFiles[key]
        )
        console.log(
          `proc${proc}[sub routine] uploadFile: ${deployFiles[key].path} response status${responseUploadFiles.statusCode}`
        )
      } else {
        console.log(
          `proc${proc}[sub routine] no need to upload file :${deployFiles[key].path}`
        )
      }
    }
  }
  console.log(`proc${proc++} uploadFiles finish ! `)

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
 * API リクエストを認証して承認するためのアクセス トークンを取得する
 * keysに認証情報が格納されている必要がある
 */
async function getAccessToken() {
  const client = new JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/firebase'],
    null
  )
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
function setTargetFiles(accessToken, versionId, deployFiles) {
  return new Promise((resolve) => {
    function callback(error, response, body) {
      if (!error && response.statusCode === 200) {
        resolve({
          uploadUrl: body.uploadUrl,
          uploadRequiredHashes: body.uploadRequiredHashes
        })
      } else {
        console.log(`error occurred at setTargetFiles: ${response.body}`)
      }
    }

    const files = {}
    for (const key of Object.keys(deployFiles)) {
      files[`${deployFiles[key].path}`] = deployFiles[key].hash
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
        files
      }
    }
    request(options, callback)
  })
}

/**
 * 必要なファイルをアップロードする
 * 取得したuploadUrlにアップロードするファイルハッシュを追加してgzをアップロードする
 */
function uploadFiles(accessToken, uploadUrl, deployFile) {
  return new Promise((resolve) => {
    function callback(error, response) {
      if (!error && response.statusCode === 200) {
        resolve(response)
      } else {
        console.log(`error occurred at uploadFiles: ${response}`)
      }
    }

    const options = {
      url: uploadUrl + '/' + deployFile.hash,
      method: 'POST',
      headers: {
        'Content-type': 'application/octet-stream',
        Authorization: 'Bearer ' + accessToken,
        'Content-Length': deployFile.binaryData.length
      },
      body: deployFile.binaryData
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
