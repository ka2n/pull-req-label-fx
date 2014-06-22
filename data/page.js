
self.port.on("updateContent", function(label) {
  var labels = {
    'レビュー依頼': '#000',
    'レビュー中': '#222',
    'レビュー完了': '#333'
  };
  var body = document.getElementsByTagName('body')[0];
  var bg = '#fff';
  var data = '';
  if (label in labels) {
    bg = labels[label];
    data = label;
  }
  body.style.backgroundColor = bg;
});
