// https://hosting-test-c0336.web.app/

// node組み込みモジュールを読み込む
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
// const streams = require('memory-streams');

// npmパッケージを読み込む
const request = require('request');
const { JWT } = require('google-auth-library');

// googleのAPIからダウンロードしたOAuth2.0の認証情報を読み込む
// https://console.developers.google.com/
const keys = require('./jwt.keys.json');
const siteName = keys.project_id;

// アップロードするファイルのsha256ハッシュ
const deployTargetPath = './public/404.html'
const deployFile = zlib.gzipSync(fs.readFileSync(deployTargetPath))
const fileHash = crypto.createHash('sha256').update(deployFile, 'utf8').digest('hex');

/**
 * エントリーポイント
 */
async function main() {
  let proc = 1;

  // API リクエストを認証して承認するためのaccess tokenを取得する
  const access_token = await getAccessToken();
  console.log(`proc${proc++} getAccessToken finish ! access token:${access_token}`);

  // 最後にreleasesされたサイトのversionNameを取得する
  const latestVersion = await getLatestVersionName(access_token);
  console.log(`proc${proc++} getLatestVersionName finish ! latest version name:${latestVersion}`);

  // versionNameで指定したversionのファイル構成を取得する
  const latestDeployedFiles = await getVersionFiles(access_token, latestVersion);
  console.log(`proc${proc++} getVersionFiles finish ! files:${latestDeployedFiles.files.length}`);

  // サイトの新しいバージョンを作成する
  const createdVersionName = await createSiteVersion(access_token);
  console.log(`proc${proc++} createSiteVersion finish !  version name:${createdVersionName}`);

  // デプロイするファイルのリストを指定してアップロード先のURLを取得する
  const uploadURL = await setTargetFiles(access_token, createdVersionName)
  console.log(`proc${proc++} setTargetFiles finish ! uploadURL:${uploadURL}`);

  // 必要なファイルをアップロードする
  const responseUploadFiles = await uploadFiles(access_token, uploadURL, deployTargetPath)
  console.log(`proc${proc++} uploadFiles finish ! response status:${responseUploadFiles.statusCode}`);

  // バージョンのステータスを FINALIZED に更新する
  const responseFinalize = await finalizeStatus(access_token, createdVersionName)
  console.log(`proc${proc++} finalizeStatus finish ! response status:${responseFinalize.statusCode}`);

  // デプロイ用にバージョンをリリースする
  const responseCallDeploy = await callDeploy(access_token, createdVersionName)
  console.log(`proc${proc++} callDeploy finish ! response status:${responseCallDeploy.statusCode}`);

};

main().catch(console.error);

/**
 * API リクエストを認証して承認するためのアクセス トークンを取得する
 * OAuth2.0クライアントを生成してaccess_tokenを取得する
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
  );
  const result = await client.authorize().catch(console.error());

  return result.access_token
}

/**
 * 指定されたサイトで作成されているリリース情報を取得する
 * クエリパラメータpageSize=1を指定しているため最新のリリース情報のみ取得する
 */
function getLatestVersionName(access_token) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(JSON.parse(body).releases[0].version.name);
      } else {
        console.log(`error occurred at getLatestVersionName: ${error}`)
      }
    }

    const options = {
      url: 'https://firebasehosting.googleapis.com/v1beta1/sites/hosting-test-c0336/releases?pageSize=1',
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + access_token
      }
    };
    request(options, callback);
  })
}

/**
 * 指定したバージョンのファイル構成を取得する
 */
function getVersionFiles(access_token, latestVersion) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(JSON.parse(body));
      } else {
        console.log(`error occurred at getVersionFiles: ${error}`)
      }
    }

    const options = {
      url: `https://firebasehosting.googleapis.com/v1beta1/${latestVersion}/files`,
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + access_token
      }
    };
    request(options, callback);
  })
}

/**
 * サイトの新しいバージョンを作成する
 */
function createSiteVersion(access_token) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(body.name);
      } else {
        console.log(`error occurred at createSiteVersion: ${error}`)
      }
    }

    const options = {
      url: 'https://firebasehosting.googleapis.com/v1beta1/sites/hosting-test-c0336/versions',
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        Authorization: 'Bearer ' + access_token
      },
      json: {
        config: {
          headers: [{
            glob: '**',
            headers: {
              'Cache-Control': 'max-age=1800'
            }
          }]
        }
      }
    };
    request(options, callback);
  })
}

/**
 * デプロイするファイルのリストを指定してアップロード先のURLを取得する
 * 事前にデプロイするファイルをgzipしておく
 */
function setTargetFiles(access_token, versionId) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(body.uploadUrl);
      } else {
        console.log(`error occurred at setTargetFiles: ${response.body}`)
      }
    }

    const options = {
      url: 'https://firebasehosting.googleapis.com/v1beta1/' + versionId + ':populateFiles',
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        Authorization: 'Bearer ' + access_token,
      },
      json: {
        files: {
          "/404.html": fileHash
        }
      }
    };
    request(options, callback);
  })
}

/**
 * 必要なファイルをアップロードする
 * 取得したuploadUrlにアップロードするファイルハッシュを追加してgzをアップロードする
 */
function uploadFiles(access_token, uploadUrl, path) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(response);
      } else {
        console.log(`error occurred at uploadFiles: ${response}`)
      }
    }

    const data = deployFile;
    const options = {
      url: uploadUrl + '/' + fileHash,
      method: 'POST',
      headers: {
        'Content-type': 'application/octet-stream',
        Authorization: 'Bearer ' + access_token,
        'Content-Length': data.length,
      },
      body: data
    };
    request(options, callback);
  });
}

/**
 * バージョンのステータスを FINALIZED に更新する
 */
function finalizeStatus(access_token, versionId) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(response);
      } else {
        console.log(`error occurred at finalizeStatus: ${response.body}`)
      }
    }

    const options = {
      url: 'https://firebasehosting.googleapis.com/v1beta1/' + versionId + '?update_mask=status',
      method: 'PATCH',
      headers: {
        'Content-type': 'application/json',
        Authorization: 'Bearer ' + access_token,
      },
      body: JSON.stringify({ "status": "FINALIZED" }),
    };
    request(options, callback);
  })
}

/**
 * デプロイ用にバージョンをリリースする
 */
function callDeploy(access_token, versionId) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(response);
      } else {
        console.log(`error occurred at callDeploy: ${response.body}`)
      }
    }

    const options = {
      url: `https://firebasehosting.googleapis.com/v1beta1/sites/${siteName}/releases?versionName=${versionId}`,
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + access_token,
      },
    };
    request(options, callback);
  })
}

