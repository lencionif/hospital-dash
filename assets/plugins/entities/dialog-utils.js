window.DialogUtils = window.DialogUtils || {};
DialogUtils.openRiddleDialog = function (riddle, opts) {
  opts = opts || {};
  var onSuccess = opts.onSuccess || function () {};
  var onFail = opts.onFail || function () {};
  var onClose = opts.onClose || function () {};
  var api = window.DialogAPI || {};
  var title = opts.title || 'Pregunta';
  var ask = riddle.ask;
  var options = riddle.options || [];
  var correctIndex = riddle.correctIndex || 0;
  if (api.openRiddle) {
    api.openRiddle({
      title: title,
      text: ask,
      hint: riddle.hint || '',
      answers: options,
      correctIndex: correctIndex,
      onSuccess: onSuccess,
      onFail: onFail,
      onClose: onClose
    });
    return;
  }
  if (api.open) {
    var buttons = options.map(function (label, idx) {
      return { label: label, action: function () { if (idx === correctIndex) onSuccess(); else onFail(); onClose(); } };
    });
    api.open({ title: title, text: ask, buttons: buttons });
    return;
  }
  console.error('[DialogUtils] No hay DialogAPI disponible para riddles');
};
