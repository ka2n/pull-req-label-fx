'use strict';


var UI = require('sdk/ui');
var Tabs = require('sdk/tabs');
var Promise = require('sdk/core/promise');
var Request = require("sdk/request").Request;
var Prefs = require("sdk/simple-prefs").prefs;

var REVIEW_LABELS = [
    null,
    'レビュー依頼',
    'レビュー中',
    'レビュー完了'
];

var menuBarButton;

function serializeFunction(f, args) {
  return '(' + f.toString() + ')' + '(' + args.map(function(v) { return JSON.stringify(v); }).join(', ') + ')';
}

function openPrefs() {
  var self = require('sdk/self');
  Tabs.open({
    url: 'about:addons',
    onReady: function(tab) {
      tab.attach({
        contentScriptWhen: 'end',
        contentScript: serializeFunction(function() {
          var addonID = arguments[0];
          AddonManager.getAddonByID(addonID, function(addon) {
            unsafeWindow.gViewController.commands.cmd_showItemDetails.doCommand(addon, true);
          });
        }, [self.id])
      });
    }
  });
}

function getAuthorization(type) {
    var base64 = require('sdk/base64');
    var username = Prefs[type+"_username"];
    var password = Prefs[type+"_password"];
    if (!username || !password) {
      return;
    }
    var raw = username + ':' + password;
    var authorization = base64.encode(raw);
    return 'Basic ' + authorization;
}

function getApiPrefix(type) {
    if (type === 'github') {
      return 'https://api.github.com/';
    } else if (type == 'ghe') {
      return Prefs.ghe_api_prefix;
    }
}

function getType(url) {
    var regex = /(https?:\/\/.*.+?\..+?)\//;
    var matches = url.match(regex);
    if (!matches) { return; }
    var heading = matches[1];
    if ( "https://github.com".indexOf(heading) === 0 ) {
        return 'github';
    } else if ( Prefs.ghe_api_prefix.indexOf(heading) === 0) {
        return 'ghe';
    }
}

function getParamsFromUrl(url) {
  var type = getType(url);
  if (!type) {
    return null;
  }
  var regex = /.+\/(.+?)\/(.+?)\/pull\/(\d+)/;
  var match = url.match(regex);
  return match ? {"user": match[1], "repo": match[2], "issue": match[3]} : null;
}

// `pageURL`のラベルを取得する
function getLabel(pageURL) {
  var deferred = Promise.defer();
  var params = getParamsFromUrl(pageURL);
  var auth = getAuthorization(getType(pageURL));
  if (params && auth) {
    Request({
      url: getApiPrefix(getType(pageURL)) + 'repos/' + params.user + '/' + params.repo + '/issues/' + params.issue + '/labels',
      headers: {'Authorization': auth},
      onComplete: function(r) {
        if (r.status == 200) {
          var label = r.json.filter(function(l) {
            return REVIEW_LABELS.indexOf(l.name) > 0;
          }).map(function(l) {
            return l.name;
          }).pop() || null;
          deferred.resolve(label);
        } else {
          deferred.reject('request failed');
        }
      }
    }).get();
  } else {
    deferred.reject('not github url');
  }
  return deferred.promise;
}

// `pageURL`にラベル`label`を追加する
function addLabel(pageURL, label) {
  var deferred = Promise.defer();
  var params = getParamsFromUrl(pageURL);
  var auth = getAuthorization(getType(pageURL));
  if (params && auth) {
    Request({
      url: getApiPrefix(getType(pageURL)) + 'repos/' + params.user + '/' + params.repo + '/issues/' + params.issue + '/labels',
      headers: {'Authorization': auth},
      content: JSON.stringify([label]),
      onComplete: function(r) { 
        deferred.resolve(); 
      }
    }).post();
  } else {
    deferred.reject('not github url');
  }
  return deferred.promise;
}

// `pageURL`から`label`を削除する
function deleteLabel(pageURL, label) {
  var deferred = Promise.defer();
  var params = getParamsFromUrl(pageURL);
  var auth = getAuthorization(getType(pageURL));
  if (params && auth) {
    Request({
      url: getApiPrefix(getType(pageURL)) + 'repos/' + params.user + '/' + params.repo + '/issues/' + params.issue + '/labels/' + label,
      headers: {'Authorization': auth},
      onComplete: function(r) {
        deferred.resolve(); 
      }
    }).delete();
  } else {
    deferred.reject('not github url');
  }
  return deferred.promise;
}


// `pageURL`のラベルを`currentLabel`の次の状態のラベルに付け替える
function forwardLabel(pageURL, currentLabel) {
  var nextLabel = REVIEW_LABELS[(REVIEW_LABELS.indexOf(currentLabel) + 1) % REVIEW_LABELS.length];
  var requests = [];
  if (currentLabel) { requests.push(deleteLabel(pageURL, currentLabel)); }
  if (nextLabel) { requests.push(addLabel(pageURL, nextLabel)); }
  return Promise.all(requests).then(function(result) {
    return nextLabel;
  });
}


// メニューバーのボタン`button`のアイコンを`label`に応じて更新する
function updateIcon(button, label) {
  switch (label) {
    case 'レビュー依頼':
      button.icon = './icon-19-requested.png';
      break;
    case 'レビュー中':
      button.icon = './icon-19-inreview.png';
      break;
    case 'レビュー完了':
      button.icon = './icon-19-ok.png';
      break;
    default:
      button.icon = './icon-19-normal.png';
    break;
  }
  button.label = label ? label : 'クリックでレビュー依頼';
}

// `tab`の背景に`label`の文字を描画します
function updateBackground(tab, label) {
  tab.attach({
    contentScript: serializeFunction(function() {
      var state = arguments[0];
      var canvas = document.createElement('canvas');
      canvas.width = 150;
      canvas.height = 120;
      var context = canvas.getContext('2d');
      var rad = 30 * Math.PI / 180;
      context.setTransform(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0 );
      context.font = "bold 20px sans-serif";
      context.fillStyle = '#ddd';
      context.textAlign = 'left';
      context.textBaseline = 'top';
      if (state) {
          context.fillText(state, 20, 20);
      }
      document.body.style.background = "url('" + canvas.toDataURL() + "')";
    }, [label])
  });
}

function handleClick() {
  // アクティブなタブのラベルを更新する
  var tab = Tabs.activeTab;
  getLabel(tab.url).then(function(cl) {
    return forwardLabel(tab.url, cl).then(function(fl) {
      updateIcon(menuBarButton, fl);
      updateBackground(tab, fl);
    });
  });
}

// アクティブなタブが変更されたらアイコンを更新する
function update(tab) {
  if (tab != Tabs.activeTab) { return; }
  getLabel(tab.url).then(function(currentLabel) {
    updateIcon(menuBarButton, currentLabel);
    updateBackground(tab, currentLabel);
  }, function() {
    updateIcon(menuBarButton, null);
  });
}


// ボタンを追加
menuBarButton = UI.ActionButton({
  id: "pullreqlabel",
  label: "Pull request label",
  icon: "./icon-19-normal.png",
  onClick: handleClick
});

// タブの更新と読み込みでラベル更新
Tabs.on('activate', update);
Tabs.on('ready', update);

exports.main = function(options, callbacks) {
  if (options.loadReason === 'install') {
    openPrefs();
  }
};
