// https://hosting-test-c0336.web.app/

const { OAuth2Client } = require('google-auth-library');
const http = require('http'); // jwt にしたら不要なはず
const url = require('url');
const open = require('open');
const destroyer = require('server-destroy'); // jwt にしたら不要なはず
const request = require('request');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// googleのAPIからダウンロードしたOAuth2.0の認証情報を読み込む
// https://console.developers.google.com/
const keys = require('./client_secret.json');
const siteName = keys.web.project_id;

// アップロードするファイルのsha256ハッシュ
const deployTargetPath = './public/404.html.gz'
const buf = fs.readFileSync(path.resolve(__dirname, deployTargetPath));
const fileHash = crypto.createHash('sha256').update(buf, 'utf8').digest('hex');

/**
 * エントリーポイント
 */
async function main() {
  let proc = 1; 

  // API リクエストを認証して承認するためのaccess tokenを取得する
  const access_token = await getAccessToken();
  console.log(`proc${proc++} getAccessToken finish ! access token:${access_token}`);

  // 最後にreleasesされたサイトのversionNameを取得する
  const latestRelease = await getLatestRelease(access_token);
  const latestVersion = latestRelease.releases[0].version.name;
  console.log(`proc${proc++} getLatestRelease finish ! latest version name:${latestVersion}`);

  // versionNameで指定したversionのファイル構成を取得する
  const latestDeployedFiles = await getVersionFiles(access_token, latestVersion);
  console.log(`proc${proc++} getVersionFiles finish ! files:${latestDeployedFiles}`);

  // サイトの新しいバージョンを作成する
  const responseVersionCreate = await createSiteVersion(access_token);
  console.log(`proc${proc++} createSiteVersion finish ! response status:${responseVersionCreate.status}, version name:${responseVersionCreate.name}`);

  // デプロイするファイルのリストを指定する
  const responseSetTargetFiles = await setTargetFiles(access_token, responseVersionCreate.name)
  console.log(`proc${proc++} setTargetFiles finish ! uploadURL:${responseSetTargetFiles.uploadUrl}`);

  // 必要なファイルをアップロードする
  const responseUploadFiles = await uploadFiles(access_token, responseSetTargetFiles.uploadUrl, deployTargetPath)
  console.log(`proc${proc++} uploadFiles finish ! response status:${responseUploadFiles.statusCode}`);

  // バージョンのステータスを FINALIZED に更新する
  const responseFinalize = await finalizeStatus(access_token, responseVersionCreate.name)
  console.log(`proc${proc++} finalizeStatus finish ! response status:${responseFinalize.statusCode}`);

  // デプロイ用にバージョンをリリースする
  const responseCallDeploy = await callDeploy(access_token, responseVersionCreate.name)
  console.log(`proc${proc++} callDeploy finish ! response status:${responseCallDeploy.statusCode}`);
};


main().catch(console.error);

/**
 * API リクエストを認証して承認するためのアクセス トークンを取得する
 * OAuth2.0クライアントを生成してaccess_tokenを取得する
 * keysに認証情報が格納されている必要がある
 * サーバ上で完結するためにはJWTでのToken取得に書き換えなければならない
 */
function getAccessToken() {
  return new Promise((resolve, reject) => {
    console.log('start step1 getAccessToken');
    const oAuth2Client = new OAuth2Client(
      keys.web.client_id,
      keys.web.client_secret,
      keys.web.redirect_uris[0]
    );

    // 同意画面に使用されるURLを生成する
    const authorizeUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: 'https://www.googleapis.com/auth/firebase'
    });

    // サーバを立ててoAuthコールバックを受ける
    // この例では立てたサーバににリクエストを送る
    const server = http
      .createServer(async (req, res) => {

        const qs = new url.URL(req.url, 'http://localhost:3000')
          .searchParams;

        const payLoad = {
          client_id: keys.web.client_id,
          client_secret: keys.web.client_secret,
          redirect_uri: keys.web.redirect_uris[0],
          grant_type: 'authorization_code',
          code: qs.get('code')
        }

        const options = {
          url: 'https://accounts.google.com/o/oauth2/token',
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          json: payLoad
        };

        function callback(error, response, body) {
          if (!error && response.statusCode == 200) {
            resolve(response.body.access_token);
          } else {
            console.log(`step1 error: ${response.message}`);
          }
        }
        request(options, callback);
      });

    server.listen(3000, () => {
      // open the browser to the authorize url to start the workflow
      open(authorizeUrl, { wait: false }).then(cp => cp.unref());
    });
    destroyer(server);
  });
}

/**
 * 指定されたサイトで作成されているリリース情報を取得する
 * クエリパラメータpageSize=1を指定しているため最新のリリース情報のみ取得する
 */
function getLatestRelease(access_token) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(JSON.parse(body));
      } else {
        console.log(`error occurred at getLatestRelease: ${error}`)
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
        resolve(body);
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
 * デプロイするファイルのリストを指定する
 * 事前にデプロイするファイルをgzipしておく
 */
function setTargetFiles(access_token, versionId) {
  return new Promise((resolve) => {

    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        resolve(body);
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
        files:{
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

    const data = fs.readFileSync(path);
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

