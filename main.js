// Start the application after the deferred script has access to the page.
// Configuration is loaded first, then OPFS records are loaded, and finally
// the terminal listener is attached so commands always have storage ready.
async function init() {
    saveConfigButton.addEventListener('click', saveConfig);
    getModelsButton.addEventListener('click', getModels);
    availableModelsSelect.addEventListener('change', syncModelSelect);
    globalCreativeControls = getDefaultCreativeControls();
    setupCreativeControls();
    loadConfig();
    setTerminalColor(localStorage.getItem('terminalColor') || 'cyan', false);
    showCreativeControls(globalCreativeControls);
    await getModels();
    opfsRoot = await navigator.storage.getDirectory();
    recordDirectory = await getRecordDirectory();
    await refreshRecords();
    renderUiState();
    mainEditor.addEventListener('input', () => {
      setSaveStatus('unsaved');
      renderUiState();
    });
    resetCreativeControlsButton.addEventListener('click', resetCreativeControls);
    commandInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = commandInput.value.trim();
        if (!command) return;
        commandInput.value = '';
        commandInput.disabled = true;
        setTerminalState('working');
        try {
          await tokenizeCommand(command);
        } catch (error) {
          console.error('Command failed:', error);
          printTerminal(`Error: ${error.message}`, 'error');
        } finally {
          commandInput.disabled = false;
          setTerminalState('ready');
          commandInput.focus();
        }
      }
    });
}

const commandInput = document.getElementById("terminal-input");
const mainEditor = document.getElementById("main-editor");
const terminalOutput = document.getElementById("terminal-output");
const currentPathElement = document.getElementById("current-path");
const editorStatusElement = document.getElementById("editor-status");
const editorTitleElement = document.getElementById("editor-title");
const saveStatusElement = document.getElementById("save-status");
const terminalStateElement = document.getElementById("terminal-state");
const terminalShell = document.querySelector(".terminal-shell");
const resetCreativeControlsButton = document.getElementById("reset-creative-controls");
const endpointInput = document.getElementById("openai-endpoint");
const apiKeyInput = document.getElementById("openai-api-key");
const modelInput = document.getElementById("openai-model");
const systemPromptInput = document.getElementById("system-prompt");
const availableModelsSelect = document.getElementById("available-models");
const saveConfigButton = document.getElementById("save-config-button");
const getModelsButton = document.getElementById("get-models-button");
const creativeControlIds = [
  'length',
  'pacing',
  'chaos',
  'dialogue-share',
  'tension',
  'premise-corehook',
  'style-guide',
  'world-rules-constraints',
  'character-ledger-and-arcs'
];
// Each source photo is sampled into a 64-by-30 character grid. The compact
// color map keeps 256 representative RGB values without bundling the JPEGs.
const neofetchArt = {
  "boykisser": {
    "width": 64,
    "text": "         ##.                                             .*%.   \r\n       .+::=-                                          .-=::*   \r\n      =*.   -+=.                                     -+=.   :#. \r\n     ++       -+=.                                .=+-       -# \r\n    =*          -+=      +=-----:.              .=+:          *-\r\n   .#             -+=    #-  ..:--==-.        .++:            .*\r\n   *-               -*-  .#.       .:==-.    =+:               *\r\n  .#                  =+: .#-          :=+:-+-                 =\r\n  -+                   :#+-=+--          .=%:                  -\r\n  =+                 :=-:.                 .=                  -\r\n  =+               .*#=--------=.                              +\r\n  .#                   ......                                  *\r\n   #:                                                         +=\r\n   :#                                                        -# \r\n    =*      ...::::.....              ==+++++---=*--        -#  \r\n     =*     -+#----#@@@@@%-          -@@@@@@%    *=        =+   \r\n      -*.    #:    #@@@@@@:          +@@@@@@%     #      =#+..  \r\n**----:=%=  -*     #@@@@@@:          =@@@@@@#     *-    -+-::=% \r\n.*- ..::::  ++     =@@@@@@           .%@@@@@:     #-        -+. \r\n  ++:       .#.     %@@@@-  ...       .+%%*:      +.      =+-   \r\n   .-==-   ..::      -+=.   -+=:               :: ..    :%-     \r\n      #- .-=*::-                              --#==:     :+-    \r\n     *-     :.           :.  .-=--::-=-         :.         =+   \r\n   .*-     .             :----:..:::..            .::.....::**  \r\n   =+------==-:.                              .:-==-:-----::.   \r\n             .:-=+-::...                  -+*--:.               \r\n                 -#=::----.                 *=                  \r\n                  .=-.                       *=                 \r\n                    :#*                       #-                \r\n                   =+.                         #.               ",
    "colors": "////////////SUna////////////////////////////////////////////////////////////2m0k2//////////////abba2kpL////////////////////////////////////////////////////////bkpK2tm3b//////////+Sbdv///+2bZLb////////////////////////////////////////////////25Jtktr////aSdv///////9tbf////////+2bZLb///////////////////////////////////////////bkm22/////////7ZJ//////+Sbf////////////+2bZL///////9tkpKSkra2ttv//////////////////9qSbbb/////////////bbb////aSf////////////////+2bZL/////Sbb//9vbtraSkpK22///////////221ttv///////////////9tJ////Sbb///////////////////+Sbbb//9tJ2v/////////btpKSktv////bkm22////////////////////bf//20n//////////////////////9uSbdr/20m229v//////////7aSbba2bbb//////////////////////5L//5Jt/////////////////////////7ZJbbaSbZK2/////////////9uSJbb///////////////////////+2//+Sbf/////////////////////btpKSttv//////////////////////9uS2///////////////////////kv//km3////////////////////bbUmStra2tpKSkpKS2////////////////////////////////////////23//9pJ////////////////////////29vb29vb29v///////////////////////////////////////////9J////Sbb///////////////////////////////////////////////////////////////////////////9tkv///7ZJ//////////////////////////////////////////////////////////////////////////+2Sf//////kkn////////b29va2tra29vb29vb/9v/////////////25KSbW1tbW2SkpKSbZKS2/////////+2Sdv///////+Sbf//////tm1Jtra2tkkAAAAAJCS2/////////////7YAAAAAAAAl/////0mS//////////+Sbf///////////7Zt2/////9Jtv////9JAAAAAAAAtv////////////9tAAAAAAAAJP//////Jdv/////25JJbdvb//9JbbaStra2kiSS//+SSf//////SQAAAAAAALb/////////////kgAAAAAAAEn//////0m2/////5Jtkra2kiXb2m2S/9vattq2tv//bW3//////5IAAAAAACT//////////////9skAAAAAAC2//////9Jtv//////////km3a////bW22/////////9pJ2///////JQAAAAC2///b29vb////////220kJW22////////bdv//////9uSbbb////////bkpKStv//+/b7trb///////+SbZLb////tm2Stv////////////////////b2//v2/////7Ylkv//////////////Sbb/+vLt5Pby8vv///////////////////////////////////////Ly5O3t9v//////tm2S////////////SZL///////b6+/////////////+22tvb2raSkra2traSkv////////////b6////////////km3////////aSbb/////29v/////////////////tpKSkpK229vatrba2////////////////9u2ttrb29va2tpJSf//////km22kpKSkpKSkpK22///////////////////////////////////////29u2tpKStra2tra2tra229v//////////9v////////btpKSbZK2ttrb29vb/////////////////////5JtSba2ttr//////////////////////////////////////////5Ilkra2tpKSktv//////////////////////22S////////////////////////////////////////////////25KS2v//////////////////////////////bZL/////////////////////////////////////////////////tklt2/////////////////////////////9Jtv//////////////////////////////////////////////km3b/////////////////////////////////0nb////////////////////"
  },
  "cherenkov": {
    "width": 64,
    "text": "######%%%%%%%#%##%%%%%%%%%%%%%%%%%#%%%%%#%%**%%%%%%%%%%%%#######\r\n#*#####%%##%%#%%##%%%%%%%%%%%%%%#####%%%#%###%##%%%%###########*\r\n#*###**#%%##%##%%%%%%%%%%%%%%%%%%%#%%%%%%%#%%%%%%%%%%%##########\r\n********####%%##%%%%%%###%%%%%%%%%%%%%%%%%%#%%%%%%%#############\r\n********#####%#######%####%%%#%%%%%%%%%%%%%#%##################*\r\n*******#######%###########%####%%%%%%%%#####################*##*\r\n*********########%###%%%%#%#####%##%%%##################******#*\r\n*+********############%%%%##############################********\r\n*+*********##########################################***********\r\n*+********########################################*##****+++****\r\n*+********############################################***++*****\r\n*+**#############*###################################*++++******\r\n#*######*****####**###*****#######********##*######**++++*******\r\n************#########*+*******************#########***++********\r\n*************#######**=+**********+++*****########****+*********\r\n************++********++*++++****+==+++***+*****#********+++***+\r\n**********+++=+********+++=-=+***+====+++*+******+++++**++++****\r\n**********++++++*******++===++**++*+--==+*+*****++++++**********\r\n***********===++*++++++++==+*****+*++===++++***++==+++**********\r\n*********+++==++++++++=====++*****++=--:=+++****+==+++**********\r\n*************++==+===-=--+++++++++++=====+*******++=++**********\r\n***************++*++++++++++++++++++=--=+++*****++=--+**********\r\n#*************************++++++++++=:-==+++++++++==+**********+\r\n###***********************+++++++**+*++==-===+=+==++************\r\n#************************+++++++********+=++=+=++++*************\r\n#************************++++++*********************************\r\n######*******++++************+********************************##\r\n########********++++****++++*********************************###\r\n#####**********+++**+++++++++++****************************#####\r\n#####****+******++++++++++*+***++++++++*******************######",
    "colors": "CgoKCgoKBgYGBgYGBgoGCgoGBgYGBgYGBgYGBgYGBgYGCgoGBgYGBgoGBg4OBgYGBgYGBgYKBgYGCgoKCgoKCgoOCgoKCgoKBgoKBgYKBgYKCgYGBgYGBgYGBgYKBgYGCgoKCgoGBgYKBgoKCgYKCgYGBgoKCgoKCgoKCgoKCgoKDgoKCg4OCgYGCgoGCgoGBgYGBgYGBgYGBgYGBgYGBgYKCgYGBgYGBgYKBgYGBgYGBgYKCgYKCgoKCgoKCgoKCg4ODg4ODg4KCgoKCgYKCgYKCgYGBgoKCgYGBgYGBgYGBgYGBgYGBgYGCgoKCgoKBgYKCgoKCgoKCgoKCgoKCg4ODg4ODg4OCgoKCgoGCgoKCgoKCgoKCgoKBgoKCgYGBgYGBgYGBgYGBgYKCgoKCgoKCgoKCgoKCgoKCgoKCg4ODg4ODg4OCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgYGBgYGBgYKCgoKCgoKCgoKCgoKCgoKCgoKCgoOCgoODg4ODg4ODg4OCgoKCgoKCgoGCgoKBgYGCgoKCgoKCgoKCgoKCgYKCgoKCgoKCgoKCgoKCgoKCgoODg4ODg4KDg4ODg4ODg4ODg4KCgoKCgoKCgoKCgoGCgYGCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKDg4ODg4ODg4ODg4ODg4ODg4ODgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCg4ODg4ODg4ODg4ODg4ODg4ODg4ODgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoOCgoODg4ODhISDg4ODg4ODg4ODg4ODg4KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCg4ODg4SDg4ODg4OEg4OCgoKCgoKCgoKCgoKCg4KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCg4SEhIODg4ODg4OCg4KCgoKCgoODg4ODgoKCgoODgoKCg4ODg4OCgoKCgoKCg4ODg4ODg4OCgoOCgoKCgoKDg4SEhISDg4ODg4ODg4OCg4ODg4ODg4ODgoKCgoKCgoKCg4SDg4ODg4ODg4ODg4ODg4ODg4ODgoKCgoKCgoKCg4ODhIODg4ODg4ODg4ODg4ODg4ODg4ODg4OCgoKCgoKCg4OMhIODg4ODg4ODg4OEg4ODg4ODg4KCgoKCgoKCg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OEhIODg4ODg4ODhIODg4SEhIODg4OEhMSEhIODg4ODg4ODg4OCg4ODg4ODg4OEhIODg4ODg4ODg4ODg4ODg4SEhIXEg4ODg4ODg4OEhISEjcXEg4ODhI3Nxc3EhIODhIODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OEhISEg4SDg4ODg4ODhISNzc3EhIODhISDhJXVzcXEg4SDg4ODg4SEhISEhIODg4ODg4ODg4ODg4ODg4ODg4ODg4SNxISEg4SDhISEhISEjc3Eg4ODg4ODg4SEhIXFxISEhIODg4SEjcTEhIODg4ODg4ODg4ODg4ODg4ODg4ODg4SMjcXEhISEhISEhIXNxcyEhIODg4ODg4OEhI3V3s3Eg4SDg4ODg43EhISDg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OEhISNxIXMjc3F1c3EhISEhIODg4SEhI3Nzc3Mg4ODg4ODg4OEhISEhIODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OEhISEhIOEhISEhISEhISEhISN1c3NxISDg4ODg4ODhI3N1cSDg4ODg4ODg4ODgoODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OEhISEhISEhISEjJ7VzcXEhISEhISEhISEjcSDg4ODg4ODg4ODhIKCgoODg4ODg4ODg4ODg4ODg4ODg4ODg4ODhISEhISEg4ODg4ODhI3Ejc3EjcSFxI3NxIODg4ODg4ODg4ODg4OCg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4SEhISEhIODg4ODg4ODhIyEhI3EjISDhISDg4ODg4ODg4ODg4ODgoODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4SEg4OEhIODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4KCgoKCgoKDg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODgoKCgoKCgoKCgoODg4ODg4ODhISDg4ODg4ODg4SEg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODgoKCgoKCgoKDg4ODg4ODg4ODg4ODg4ODhIOEhIODhISEg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCgoKCgoKCgoKCg4ODg4ODg4ODg4ODg4SDg4SEhISEg4ODg4ODhISEhISEhIODg4OCgoODg4ODg4ODg4ODg4OCgoKCgoK"
  },
  "snep": {
    "width": 64,
    "text": "--===-==========-------==-===:.::::-------++-..:.         ..    \r\n=-----::-=--------=--------=:.........::..::.  . ..             \r\n+===-:.==++++**+++##+=====--...  ..::.:..   ......:--:..        \r\n--==--=**#*##*++++*###**++++==---:::..:::---::----:--==-:..     \r\n-:====*##*+#*+*+++=+#****++***###*##*=---==--:-+==-----=--:.  . \r\n=-==-=*#*#*+=+++++++*++++*++++*##*%%%####+++=-=====-=====--.  . \r\n====:+#**#+=++-=---+*++++***=+*#*#%%%#%%#****+--====-====-..  . \r\n==++=**#**+*+*+::-++===++*##*+***#%%%##%%##*+#+=:.-=--=+=: .... \r\n:-+****#**=---+---=-===***##*+#**%*###****#****+-  ....::...... \r\n..:+#**++*+=-:::::-====+*+*****++*###*##**++*++#*:  .   ... ..  \r\n..=##**+=--==:-::-==--=+****+++***#**%##%%*#*=+**+: .. ..... .  \r\n .+##+--=---------::=++*=+##====++*####%###++++%%+*=:::::... .. \r\n.:+##+-:--:::::::::---:-++*#=-----=**%%#%%++*++**+#*===---:.....\r\n..+##*+==-:::::::.:::.:==**+=-==-=#**#**%%++****%#+*=:::-==::---\r\n+=+#%++*==-----:::.::.-==+#*=====#*#@@#+**+=++*++++#+:::-==::-==\r\n++=*#*+---++=--:-----===*+=++*++*#+#%#+#@***===**++##=======-...\r\n..:=*#*+--+**=::::-=+++==*++#@@@#**+=+#***+===+**#++#*--==-=:   \r\n.:--+*#*--++++-::::-*+*==*+=#@@@@%%++%%#%*-==*%++*++*#+---:: .::\r\n-:..-=====++++--:::-%*--*+*+++++##+++***%+==+*%*+==+%%=.....  :-\r\n-..-=------=+++=--:-++=+#*++=--=+****###+===+=**===-#%=..      .\r\n..:=======-.:---==--:-+#**+===+*****#**+====-=**=====**:......  \r\n  .=+====+- ......::-+*++*++++*+++*+***==-:--:=#+==-=#@+.  .:::.\r\n:  .-+===:   .::.  ..-=+++===-=-==-=##+==--:---*#+=-+#@%=  ..:==\r\n-:..:-==:     .-:...   .::..:...::::----------:=#*++*##%*: ..:=-\r\n-.:---:-.    ....           ...  .......:::--:::-*++===+%#:::.::\r\n-::===--:.     .           ..   .... ......:::...=*+=+*%@%=:..:-\r\n----====+-   .:-:               ....  .......::.::**+*#%@@#::---\r\n---=+==++=:--===-           ...   .....:::.....:::=+++****#=--=-\r\n===+====+=:-++++-...     .---==-:......::::::::::::-===+#%@#=---\r\n=-:.-===:.  .:--:  -.     -+==-=:...-::::..::.....:::-==#%%%*:::",
    "colors": "srGxsbGxsbKRkbGxsbGRsbKysrKysrKysrKRkZHa2ra21ra2traStraSjY2y2tu22/v/+///////29vb+/v//5G2srKyttbWsrGxsrKysra2trKytraysrKysrG229vb29vb29vb27bb27a22vv72//b2/////////////////+NkZGxsrbakpFtbW1tbW1tbW1JRI2RkbGxsbK229vb+9vb2tq22tra29v/+9vb29rb27a2trbb2/////vb29v/srKRsbK2kW1JSWlJSWmNbW2NaURJSUltbW1tbZKSsra2tra229vWtra2tra2trK2tra2trKSkrK22tv//9vb/7K2srGxkUlJSWltSW2NbW2NjZGNSWltSW1tbW1tSUlJSUlJSUmSkpKykpK2traSjY2xsra2kraStra229vb2/+RsrGRspFJSWlJaW2RjW2NjY2NjW2NjW1tbW2NjY1JSUlJJSQkSUlJSW1tbZKykpKRkbGykpKxkZK2ttv729v/kbGRsrZtSWlpSW2RjY2ysba2sY1tjY2NbWlpaZFtaUltSSQkJSUkJUlJaWlpjZKSkrKSkpKSjZGRstra2/vb/5GRjY2SSUlJbWmNbY1tjbbWto2NsZGRbW1pSUltjUlJbUklJCVJSSUlSUlpbUltkrbatpK2tpKNkbbb29vb2/+2tm1JSWltSUlpkra2ko2ytrKxtpGRkW1tbUlJSY1JaUklSUlJSUlJbW1JaWlpbW22+/va2tvattrb29va29v729u2bUVpbW2NaW2RttbWtta2srGRkZFtaW1JbW1tbW1tSUlJSW1JSW1tbW1tbY1Jbbb/+9v7+/vb29v729v7/9vbkklJbWltkbGxsbHWtta2trGRtrKRbW1paWmNbW1tbUlJSW0lSSUkJW1JaY2NSUmNtvvb29vb29vb29vb+//b225JSY2ysrGytra2trK2trbWtpGNjW2RbUlJkZGxkY1tbSVJSSUlSSVEjW1tjSQkbW2Stra22tba29v729v/27ZuSUmNsra2trbW1ta21tbW1ra2tra2bW1pRJGysbaytpFJbSQkSSQkbY1pbY1tbW1JSZGSkra2srba29ra29vbbklEaY2RsrbW1ta2ttba2trW1tq2kZFtaW2RspGSkpFJaW1JSW0lJG1tbW1tbSRJbUmStra2tpGRtra2trZtkW5JRG2NbZGRsra2trbWttba2tbatpGNbUltkZGRkZFJSUkAAEltaW1tkY1tbW1tbW1Jbba2trKRkba2tpKRbW2SaUlpjbG2sm5tkra2tra2sra2kY2RbW2RbY1tbW1JSW1JJEltSSRJbW2RkZFpaW1tSUmRsZGRsbGRstva2trbtpFpSWmNtrZtbW2Stra2traSbW2NkZFtjW1JAAAkSW1JbZFtSUlJSY2RkZFtSUlJbW1JabKykZGyktb////a1rK2jWlpbbaybW1tbra2tra2tkltaY2RaY2SSQAAAAAkJW1tJSRJJGmysZFpJW2NbW2NSUWNsrK2ttrb27a2sdbb2rKRkZGxkm1tbW6Stra2trIlabGxaW1pbW1tjW1JSW1tbUltSSRtkpFtSSVJbZGSjSQlktvb29vb29vWtrba2rKxsrK2srayjW1tbpKStra2bW2xbUltjY2RsbKRbW1JSUlJSUltkZKSbZJtSZGSkpJJJJLb29v/////+9vb2raSkZGxsbGRttrWtrKykpKSttu2jUltaW2RkZGNbUltaWlJSUltkpKSkraSSUmSkpKRkWlJttra29ra2/v/+//bko2RsbGxjbbb29rb29va1raSjW2NbW1tjY1tbY2NbW1tbWltkZKStpKStpJJbZKSkpFJJG3b29vatra22rb/+9uyjZGRkbb//9vb2trb//vb2raRbY2NkZKStpK2kZKykUlJbpKSsra2traSSUltkpKRSSQkkv/7+9u2kZGy2trbtrKNkdb////7/9uy1tvb29v//9rW1trattvb27a2tra2tra2tra2kra2tpJJbW1tbUlFJUna+9va1pK2ttq2trGytrLa/////9vb29v/////////////+9vb29vb29vb29vb27e2tra2tre3kkltbZKSkW0kSdba1tq2trbWtpGRkbK2ttv/////29vb/////////////9vb+9vb29vb29vb29vb29u3t7fb29uSbW2SbUkkACSR1tra1rK2traykZGRkY222/v729a21v////////////v7+////9vb29v/+9vb29vb29u7t9vbtm1tbW1JJAAASbbWtra2srK2kY2RkY2Nkba2spKRkbb7+//////////7+9vb29v7+9vb29vbtrbW29vb29u2treSbW1tbUlJSUmRtrKRspGxkY2RkZGRjZHWso2NjY2229vb///////btrKykZGyttrb29rb2ra2ttbWtrbW1ra2traSkpFtSSQARZG2srKRtrbaspGRkrbb///btrKy2v//str//////7aNsbGxkdra29q2tta21tvb1tbb29vb29u3t7aSkkklJCRJtra2"
  }
};
const terminalColors = {
  cyan: '#71d0ff',
  blue: '#6d8cff',
  green: '#77e8b5',
  yellow: '#ffd36d',
  red: '#ff7890',
  pink: '#ff86d3',
  white: '#e8f7ff'
};

// These values are shared by every terminal command. In particular,
// currentPath must live outside executeCommand() so it survives between
// commands in the same way a shell's working directory does.
let recordDirectory;
let recordArray = [];
let currentPath = '/';
let currentRecord = null;
let globalCreativeControls = {};
let creativeOverrideIds = new Set();


// Turn raw terminal text into one small command object. Flags are kept
// separate from positional arguments, and quoted values remain one argument.
async function tokenizeCommand(command) {
  if (command === '') {
    return null;
  }
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(part => part.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) || [];
  const flags = [];
  const args = [];
  for (const part of parts.slice(1)) {
    if (part.startsWith('--')) flags.push(part);
    else if (/^-[^-]+$/.test(part)) flags.push(...part.slice(1).split('').map(flag => '-' + flag));
    else args.push(part);
  }
  return executeCommand({
    cmd: parts[0].toLowerCase(),
    flags,
    args
  });
}

// Dispatch one parsed command. Each branch returns after it finishes so the
// handlers stay independent instead of accidentally nesting inside each other.
async function executeCommand({ cmd, flags, args }) {
  const [inputdir, outputdir] = args;

  // A destination can be one scene or any container above it. Generation is
  // deliberately sequential so each completed scene is saved before the next
  // request begins. Filters can select missing or stale scenes, --dry-run only
  // prints the queue, and --force deliberately ignores the filters.
  if (cmd === 'generate' || cmd === 'gen' || cmd === 'g') {
    const destination = resolvePath(inputdir || currentPath);
    let scenes = getScenesUnder(destination);
    if (hasFlag(flags, '--force', '-f')) {
      // Force deliberately keeps the full queue, even when filter flags exist.
    } else if (hasFlag(flags, '--missing', '-m')) {
      scenes = scenes.filter(record => !record.content?.trim());
    } else if (hasFlag(flags, '--stale', '-s')) {
      scenes = scenes.filter(record => record.stale === true);
    }
    if (!scenes.length) {
      printTerminal('No scenes to generate.');
      return;
    }
    if (hasFlag(flags, '--dry-run', '-n')) {
      printTerminal(`Would generate ${scenes.length} scene${scenes.length === 1 ? '' : 's'}:\n${scenes.map(record => record.path).join('\n')}`);
      return;
    }
    for (const [index, record] of scenes.entries()) {
      printTerminal(`Generating ${index + 1}/${scenes.length}: ${record.path}`);
      const controls = resolveCreativeControls(record);
      const params = getGenerationParams(controls);
      const generation = await openaiGen(resolveSceneContext(record, controls), params);
      if (generation === null) {
        printTerminal(`Generation failed: ${record.path}`, 'error');
        return;
      }
      record.content = generation.content;
      record.updatedAt = new Date().toISOString();
      record.lastGeneration = { controls, params, ...generation.metrics, generatedAt: record.updatedAt };
      await saveRecord(recordDirectory, record);
      if (currentRecord?.id === record.id) {
        mainEditor.value = generation.content;
        setSaveStatus('saved');
      }
    }
    await refreshRecords();
    printTerminal(`Generated ${scenes.length} scene${scenes.length === 1 ? '' : 's'}.`);
    return;
  }

  if (cmd === 'save' || cmd === 's') {
    if (!currentRecord) {
      printTerminal('Load or create a scene before saving.');
      return;
    }
    currentRecord.content = mainEditor.value;
    currentRecord.creativeControls = readCreativeOverrides();
    currentRecord.updatedAt = new Date().toISOString();
    await saveRecord(recordDirectory, currentRecord);
    await refreshRecords();
    setSaveStatus('saved');
    printTerminal(`Saved ${currentRecord.path}.`);
    return;
  }

  if (cmd === 'load' || cmd === 'l') {
    const target = inputdir || currentPath;
    if (resolvePath(target) === '/') {
      currentRecord = null;
      currentPath = '/';
      mainEditor.value = '';
      creativeOverrideIds.clear();
      showCreativeControls(globalCreativeControls);
      setSaveStatus('ready');
      printTerminal('Loaded global creative defaults.');
      return;
    }
    const record = findRecord(target);
    if (!record) {
      printTerminal(`Record not found: ${target}`);
      return;
    }
    currentRecord = record;
    currentPath = record.path;
    mainEditor.value = record.content || '';
    creativeOverrideIds = new Set(Object.keys(record.creativeControls || {}));
    showCreativeControls(resolveCreativeControls(record), creativeOverrideIds);
    setSaveStatus('saved');
    printTerminal(`Loaded ${record.path}.`);
    return;
  }

  if (cmd === 'delete' || cmd === 'del' || cmd === 'rm' || cmd === 'd') {
    const record = findRecord(inputdir || currentPath);
    if (!record) {
      if (!hasFlag(flags, '--force', '-f')) printTerminal(`Record not found: ${inputdir || currentPath}`);
      return;
    }
    if (record.type !== 'scene' && !hasFlag(flags, '--recursive', '-r')) {
      printTerminal(`Use --recursive or -r to delete ${record.path} and its contents.`);
      return;
    }
    // Removing a container also removes every record below its virtual path.
    const records = record.type === 'scene'
      ? [record]
      : recordArray.filter(item => item.path === record.path || isPathInside(item.path, record.path));
    for (const item of records) await deleteRecord(recordDirectory, item.id);
    if (records.some(item => item.id === currentRecord?.id)) {
      currentRecord = null;
      currentPath = '/';
      mainEditor.value = '';
      creativeOverrideIds.clear();
      showCreativeControls(globalCreativeControls);
      setSaveStatus('ready');
    }
    await refreshRecords();
    printTerminal(`Deleted ${records.length} record${records.length === 1 ? '' : 's'}.`);
    return;
  }

  if (cmd === 'list' || cmd === 'ls') {
    const scope = resolvePath(inputdir || currentPath);
    const records = hasFlag(flags, '--recursive', '-r')
      ? recordArray.filter(record => scope === '/' || record.path === scope || isPathInside(record.path, scope))
      : recordArray.filter(record => record.parentPath === scope || (record.path === scope && record.type === 'scene'));
    printTerminal(records.length ? records.map(formatRecord).join('\n') : 'No records.');
    return;
  }

  if (cmd === 'neofetch' || cmd === 'neo') {
    await showNeofetch(inputdir || 'cherenkov');
    return;
  }

  if (cmd === 'color') {
    setTerminalColor(inputdir || 'reset');
    return;
  }

  if (cmd === 'clear' || cmd === 'clr' || cmd === 'cls') {
    terminalOutput.replaceChildren();
    return;
  }

  if (cmd === 'help' || cmd === 'h') {
    printTerminal(
      'Commands:\n' +
      'ls [-r|--recursive] [path]\n' +
      'mkdir [-p|--parents] <path>\n' +
      'touch <scene>\n' +
      'load <path|id> | save | pwd | cd <path>\n' +
      'mv [-f|--force] <source> <destination>\n' +
      'rm [-r|--recursive] [-f|--force] <path|id> (combined: -rf)\n' +
      'generate [-m|--missing] [-s|--stale] [-f|--force] [-n|--dry-run] [path]\n' +
      'neofetch [-a|--ascii] [boykisser|cherenkov|snep]\n' +
      'color [cyan|blue|green|yellow|red|pink|white|reset]\n' +
      'clear | help'
    );
    return;
  }

  if (cmd === 'move' || cmd === 'mv') {
    if (!inputdir || !outputdir) {
      printTerminal('Usage: mv <source> <destination>');
      return;
    }
    const moved = await moveRecord(resolvePath(inputdir), resolvePath(outputdir), hasFlag(flags, '--force', '-f'));
    if (moved) printTerminal(`Moved ${inputdir} to ${outputdir}.`);
    return;
  }

  if (cmd === 'new' || cmd === 'touch') {
    if (!inputdir) return printTerminal('Usage: touch <path>');
    await createRecord(resolvePath(inputdir), 'scene');
    return;
  }

  if (cmd === 'mkdir') {
    if (!inputdir) return printTerminal('Usage: mkdir <path>');
    const path = resolvePath(inputdir);
    if (!inferType(path) || inferType(path) === 'scene') return printTerminal('mkdir can create folders, books, and chapters. Use touch for scenes.');
    if (hasFlag(flags, '--parents', '-p')) {
      const parts = path.split('/').filter(Boolean);
      for (let index = 1; index <= parts.length; index++) {
        const parent = '/' + parts.slice(0, index).join('/');
        if (!findRecord(parent)) await createRecord(parent);
      }
    } else {
      await createRecord(path);
    }
    return;
  }

  if (cmd === 'pwd') {
    printTerminal(currentPath);
    return;
  }

  if (cmd === 'cd') {
    const path = resolvePath(inputdir || '/');
    if (path !== '/' && !findRecord(path)) return printTerminal(`Path not found: ${path}`);
    currentPath = path;
    printTerminal(currentPath);
    return;
  }

  printTerminal(`Unknown command: ${cmd}`);
}

function printTerminal(message, tone = '') {
  const entry = document.createElement('pre');
  entry.className = `terminal-entry ${tone}`.trim();
  entry.textContent = message + '\n';
  terminalOutput.appendChild(entry);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
  renderUiState();
}

// One CSS variable controls the prompt, typed command, command output, and
// neofetch information. Saving the name makes the choice survive a reload.
function setTerminalColor(name, announce = true) {
  const normalized = name.toLowerCase();
  const color = normalized === 'reset' ? terminalColors.cyan : terminalColors[normalized];
  if (!color) {
    if (announce) printTerminal(`Unknown color: ${name}`, 'error');
    return;
  }
  terminalShell.style.setProperty('--terminal-color', color);
  localStorage.setItem('terminalColor', normalized === 'reset' ? 'cyan' : normalized);
  if (announce) printTerminal(`Terminal color: ${normalized}`, 'success');
}

// Neofetch reads live browser information and only compares generation speed
// samples made with the endpoint and model that are selected right now.
async function showNeofetch(requestedName) {
  const name = requestedName.toLowerCase().replace(/\.(jpg|jpeg|png)$/, '');
  if (!neofetchArt[name]) {
    printTerminal(`Unknown ASCII variant: ${requestedName}\nAvailable: ${Object.keys(neofetchArt).join(', ')}`, 'error');
    return;
  }

  const endpoint = endpointInput.value.replace(/\/$/, '');
  const samples = recordArray
    .map(record => record.lastGeneration)
    .filter(generation => generation?.endpoint === endpoint
      && generation?.model === modelInput.value
      && Number.isFinite(generation?.tokensPerSecond));
  const speeds = samples.map(generation => generation.tokensPerSecond);
  // Storage estimates are optional browser features. Neofetch should still
  // render if a privacy setting blocks one of these queries.
  const storage = navigator.storage.estimate
    ? await navigator.storage.estimate().catch(() => ({}))
    : {};
  const persisted = navigator.storage.persisted
    ? await navigator.storage.persisted().catch(() => false)
    : false;
  const counts = Object.fromEntries(['folder', 'book', 'chapter', 'scene'].map(type => [type, recordArray.filter(record => record.type === type).length]));
  const controls = currentRecord ? resolveCreativeControls(currentRecord) : globalCreativeControls;
  const params = getGenerationParams(controls);
  const rows = [
    ['ascii', name],
    ['browser', getBrowserName()],
    ['viewport', `${window.innerWidth}x${window.innerHeight}`],
    ['api', endpoint || 'not configured'],
    ['model', modelInput.value || 'not selected'],
    ['median tok/s', speeds.length ? median(speeds).toFixed(2) : 'no samples'],
    ['speed samples', String(speeds.length)],
    ['storage', `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`],
    ['persistent', persisted ? 'yes' : 'no'],
    ['records', `${recordArray.length} (${counts.scene} scenes)`],
    ['hierarchy', `${counts.folder}F ${counts.book}B ${counts.chapter}C`],
    ['path', currentPath],
    ['params', `${params.max_tokens} max · t ${params.temperature} · p ${params.top_p}`]
  ];
  renderNeofetch(name, rows);
}

function renderNeofetch(name, rows) {
  const wrapper = document.createElement('div');
  wrapper.className = 'neofetch-output';
  const art = document.createElement('pre');
  art.className = `neofetch-ascii ${name}`;
  art.setAttribute('aria-label', `${name} photo rendered as colored ASCII art`);
  renderColoredAscii(art, neofetchArt[name]);
  const info = document.createElement('div');
  info.className = 'neofetch-info';
  const title = document.createElement('div');
  title.className = 'neofetch-title';
  title.textContent = 'cherenkov@browser';
  info.appendChild(title);
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'neofetch-row';
    const labelElement = document.createElement('span');
    labelElement.className = 'neofetch-label';
    labelElement.textContent = `${label}:`;
    const valueElement = document.createElement('span');
    valueElement.className = 'neofetch-value';
    valueElement.textContent = value;
    row.append(labelElement, valueElement);
    info.appendChild(row);
  }
  wrapper.append(art, info);
  terminalOutput.appendChild(wrapper);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Adjacent characters with the same sampled color share one span. This keeps
// the higher-resolution art much lighter than creating one element per cell.
function renderColoredAscii(element, art) {
  const colors = Uint8Array.from(atob(art.colors), character => character.charCodeAt(0));
  const lines = art.text.split(/\r?\n/);
  for (const [row, line] of lines.entries()) {
    for (let start = 0; start < line.length;) {
      const color = colors[row * art.width + start];
      let end = start + 1;
      while (end < line.length && colors[row * art.width + end] === color) end++;
      const run = document.createElement('span');
      run.style.color = unpackPhotoColor(color);
      run.textContent = line.slice(start, end);
      element.appendChild(run);
      start = end;
    }
    if (row < lines.length - 1) element.append('\n');
  }
}

// The packed byte uses three bits each for red and green and two for blue.
// Expanding those channels here restores the sampled photo palette.
function unpackPhotoColor(color) {
  const red = Math.round((color >> 5) * 255 / 7);
  const green = Math.round(((color >> 2) & 7) * 255 / 7);
  const blue = Math.round((color & 3) * 255 / 3);
  return `rgb(${red} ${green} ${blue})`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function getBrowserName() {
  const userAgent = navigator.userAgent;
  if (userAgent.includes('Edg/')) return 'Edge';
  if (userAgent.includes('Firefox/')) return 'Firefox';
  if (userAgent.includes('Chrome/')) return 'Chrome';
  if (userAgent.includes('Safari/')) return 'Safari';
  return navigator.platform || 'Browser';
}

// Keep the small status areas in sync without introducing application state
// beyond the values the editor and shell already own.
function renderUiState() {
  const text = mainEditor.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  currentPathElement.textContent = currentPath;
  editorStatusElement.textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} character${text.length === 1 ? '' : 's'}`;
  editorTitleElement.textContent = currentRecord?.name || 'no scene loaded';
}

function setSaveStatus(status) {
  saveStatusElement.textContent = status;
  saveStatusElement.dataset.state = status;
}

function setTerminalState(status) {
  terminalStateElement.textContent = status;
  terminalStateElement.dataset.state = status;
}

// Sliders update both their visible values and their filled tracks immediately.
// Reset uses the defaults declared beside each input in index.html.
function setupCreativeControls() {
  const panel = document.getElementById('creative-controls');
  panel.addEventListener('input', handleCreativeInput);
}

function updateSlider(slider) {
  const output = document.querySelector(`[data-value-for="${slider.id}"]`);
  if (output) output.textContent = `${slider.value}%`;
  slider.style.setProperty('--value', `${slider.value}%`);
  slider.style.setProperty('--slider-color', `hsl(${195 + Number(slider.value) * 1.25} 100% 62%)`);
}

function getDefaultCreativeControls() {
  return Object.fromEntries(creativeControlIds.map(id => {
    const control = document.getElementById(id);
    return [id, control.dataset.default ?? ''];
  }));
}

function showCreativeControls(values, localIds = new Set()) {
  for (const id of creativeControlIds) {
    const control = document.getElementById(id);
    control.value = values[id] ?? '';
    control.dataset.source = currentRecord && !localIds.has(id) ? 'inherited' : 'local';
    control.title = control.dataset.source === 'inherited' ? 'Inherited from a parent' : '';
    if (control.matches('input[type="range"]')) updateSlider(control);
  }
}

function handleCreativeInput(event) {
  const control = event.target;
  if (!creativeControlIds.includes(control.id)) return;
  if (control.matches('input[type="range"]')) updateSlider(control);
  if (currentRecord) {
    creativeOverrideIds.add(control.id);
    control.dataset.source = 'local';
    control.title = '';
    setSaveStatus('unsaved');
  } else {
    globalCreativeControls[control.id] = control.value;
  }
  setTerminalState('controls changed');
}

function resetCreativeControls() {
  if (currentRecord) {
    creativeOverrideIds.clear();
    showCreativeControls(resolveCreativeControls(currentRecord, true), creativeOverrideIds);
    setSaveStatus('unsaved');
    setTerminalState('inheriting parent controls');
  } else {
    globalCreativeControls = getDefaultCreativeControls();
    showCreativeControls(globalCreativeControls);
    setTerminalState('controls reset');
  }
}

function readCreativeControls() {
  return Object.fromEntries(creativeControlIds.map(id => [id, document.getElementById(id).value]));
}

function readCreativeOverrides() {
  const values = readCreativeControls();
  return Object.fromEntries([...creativeOverrideIds].map(id => [id, values[id]]));
}

// Long and short flag names are accepted by the same command branches.
// tokenizeCommand() expands a combined flag such as -rf into -r and -f.
function hasFlag(flags, ...names) {
  return names.some(name => flags.includes(name));
}

// Story paths are virtual. OPFS does not contain this folder structure; it
// stores flat JSON files by immutable ID while each record carries its path.
// Normalization removes duplicate separators, dots, and parent traversals.
function normalizePath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    part === '..' ? parts.pop() : parts.push(part);
  }
  return '/' + parts.join('/');
}

function resolvePath(path) {
  if (!path || path === '.') return currentPath;
  return normalizePath(path.startsWith('/') ? path : `${currentPath}/${path}`);
}

function isPathInside(path, scope) {
  return path?.startsWith(scope === '/' ? '/' : scope + '/');
}

function inferType(path) {
  // The hierarchy is fixed: /folder/book/chapter/scene.
  return ['root', 'folder', 'book', 'chapter', 'scene'][normalizePath(path).split('/').filter(Boolean).length] || null;
}

// IDs remain valid after a move, while paths are convenient in the terminal,
// so record lookup accepts either form.
function findRecord(pathOrId) {
  if (!pathOrId) return null;
  return recordArray.find(record => record.id === pathOrId)
    || recordArray.find(record => record.path === resolvePath(pathOrId))
    || null;
}

function formatRecord(record) {
  return `${(record.type || 'record').padEnd(7)} ${record.path || record.id}`;
}

function getScenesUnder(path) {
  return recordArray
    .filter(record => record.type === 'scene' && (record.path === path || isPathInside(record.path, path)))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.path.localeCompare(b.path));
}

// Controls resolve through the same virtual hierarchy as story context.
// Each record stores only its own overrides, so later parent edits still flow
// down to children that have not overridden that specific value.
function resolveCreativeControls(record, ignoreCurrent = false) {
  const resolved = { ...globalCreativeControls };
  const hierarchy = recordArray
    .filter(item => item.path && (item.path === record.path || isPathInside(record.path, item.path)))
    .sort((a, b) => a.path.length - b.path.length);
  for (const item of hierarchy) {
    if (!ignoreCurrent || item.id !== record.id) Object.assign(resolved, item.creativeControls || {});
  }
  return resolved;
}

// Build the user message from the scene and all of its ancestors. The order
// is broad context first and scene-specific context last.
function resolveSceneContext(scene, controls = resolveCreativeControls(scene)) {
  const hierarchy = recordArray
    .filter(record => record.path && (record.path === scene.path || isPathInside(scene.path, record.path)))
    .sort((a, b) => a.path.length - b.path.length)
    .map(record => [
      `${record.type}: ${record.path}`,
      record.premise,
      record.instructions,
      record.type === 'scene' ? record.content : null
    ].filter(Boolean).join('\n'))
    .join('\n\n');
  return [hierarchy, getCreativeContext(controls)].filter(Boolean).join('\n\n');
}

// Creative controls are prompt guidance rather than a second settings engine.
// This keeps them provider-independent while still making every control useful.
function getCreativeContext(values) {
  const notes = [
    ['Core hook', values['premise-corehook']],
    ['Style guide', values['style-guide']],
    ['World rules and constraints', values['world-rules-constraints']],
    ['Character ledger and arcs', values['character-ledger-and-arcs']]
  ].filter(([, value]) => value.trim());
  return [
    'Creative controls:',
    `Length: ${values.length}/100`,
    `Pacing: ${values.pacing}/100`,
    `Chaos: ${values.chaos}/100`,
    `Dialogue share: ${values['dialogue-share']}/100`,
    `Tension: ${values.tension}/100`,
    ...notes.map(([label, value]) => `${label}: ${value}`)
  ].join('\n');
}

// Map only controls with a sensible API equivalent. Dialogue share and the
// prose notes remain prompt guidance because chat APIs have no direct fields
// for them.
function getGenerationParams(values) {
  const scale = (value, minimum, maximum) => minimum + Number(value) / 100 * (maximum - minimum);
  return {
    max_tokens: Math.round(scale(values.length, 256, 4096)),
    temperature: Number(scale(values.chaos, 0.2, 1.5).toFixed(2)),
    top_p: Number(scale(values.pacing, 0.65, 1).toFixed(2)),
    presence_penalty: Number(scale(values.tension, 0, 0.8).toFixed(2))
  };
}

async function refreshRecords() {
  recordArray = await loadAllRecords(recordDirectory);
  document.getElementById('explorer-content').textContent = recordArray
    .sort((a, b) => (a.path || a.id).localeCompare(b.path || b.id))
    .map(formatRecord)
    .join('\n') || 'no records yet';
}

// New records use one consistent shape. The path depth supplies the node type,
// and a scene created with touch becomes the active editor record immediately.
async function createRecord(path, requestedType) {
  if (findRecord(path)) return printTerminal(`Path already exists: ${path}`);
  const type = requestedType || inferType(path);
  if (!type || type === 'root' || (requestedType === 'scene' && inferType(path) !== 'scene')) {
    return printTerminal('Paths must follow /folder/book/chapter/scene.');
  }
  const parentPath = normalizePath(path.substring(0, path.lastIndexOf('/')) || '/');
  if (parentPath !== '/' && !findRecord(parentPath)) return printTerminal(`Parent path not found: ${parentPath}`);
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    type,
    path,
    parentPath,
    name: path.split('/').pop(),
    order: recordArray.filter(item => item.parentPath === parentPath).length,
    premise: '',
    content: '',
    creativeControls: {},
    createdAt: now,
    updatedAt: now
  };
  await saveRecord(recordDirectory, record);
  await refreshRecords();
  if (type === 'scene') {
    currentRecord = record;
    currentPath = path;
    mainEditor.value = '';
    creativeOverrideIds.clear();
    showCreativeControls(resolveCreativeControls(record), creativeOverrideIds);
    setSaveStatus('saved');
  }
  printTerminal(`Created ${type}: ${path}`);
}

// Send one OpenAI-compatible chat-completions request for one scene. The
// system prompt and inherited story context are separate message roles.
async function openaiGen(context, params) {
  try {
    const startedAt = performance.now();
    const endpoint = endpointInput.value.replace(/\/$/, '');
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        model: modelInput.value,
        ...params,
        messages: [
          { role: 'system', content: systemPromptInput.value },
          { role: 'user', content: context }
        ]
      })
    });
    const output = await response.json();
    if (!response.ok || output?.error) throw new Error(output?.error?.message || `HTTP ${response.status}`);
    const content = output?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('API response missing content.');
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const completionTokens = Number(output.usage?.completion_tokens) || Math.max(1, Math.round(content.length / 4));
    return {
      content,
      metrics: {
        endpoint,
        model: modelInput.value,
        completionTokens,
        elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
        tokensPerSecond: Number((completionTokens / elapsedSeconds).toFixed(2))
      }
    };
  } catch (error) {
    console.error('Generation failed:', error);
    return null;
  }
}

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(apiKeyInput.value && { Authorization: `Bearer ${apiKeyInput.value}` })
  };
}

// Store the small provider configuration in localStorage. Story records stay
// in OPFS and are never mixed into this configuration object.
function loadConfig() {
  try {
    const config = JSON.parse(localStorage.getItem('config')) || {};
    endpointInput.value = config.endpoint || '';
    apiKeyInput.value = config.apiKey || '';
    modelInput.value = config.model || '';
    systemPromptInput.value = config.systemPrompt || '';
    Object.assign(globalCreativeControls, config.creativeControls || {});
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

function saveConfig() {
  localStorage.setItem('config', JSON.stringify({
    endpoint: endpointInput.value,
    apiKey: apiKeyInput.value,
    model: modelInput.value,
    systemPrompt: systemPromptInput.value,
    creativeControls: globalCreativeControls
  }));
  setTerminalState('configuration saved');
}

init();


// Fetch the model list from an OpenAI-compatible /models endpoint and replace
// the selector options with the IDs returned by the provider.
async function getModels() {
  if (!endpointInput.value) return;
  try {
    const response = await fetch(`${endpointInput.value.replace(/\/$/, '')}/models`, { headers: apiHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || `HTTP ${response.status}`);
    if (!Array.isArray(result?.data)) throw new Error('Model response is missing data.');
    availableModelsSelect.replaceChildren(
      new Option('available models', ''),
      ...result.data.filter(model => model.id).map(model => new Option(model.id, model.id))
    );
    setTerminalState(`${result.data.length} model${result.data.length === 1 ? '' : 's'}`);
  } catch (error) {
    console.error('Failed to fetch models:', error);
  }
}

function syncModelSelect() {
  modelInput.value = availableModelsSelect.value;
}

let opfsRoot;

// OPFS provides private, browser-managed storage for this origin. Cherenkov
// keeps every story record in the single "records" directory below the root.
async function readJson(fileHandle) {
  return JSON.parse(await (await fileHandle.getFile()).text());
}

async function writeJson(fileHandle, data) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// Record files are named <immutable-id>.json. Virtual moves only update the
// path fields inside these files; their OPFS filenames never need to change.
function getRecordDirectory() {
  return opfsRoot.getDirectoryHandle('records', { create: true });
}

function getRecordHandle(recordsDirectory, id, create = false) {
  return recordsDirectory.getFileHandle(`${id}.json`, { create });
}

async function saveRecord(recordsDirectory, record) {
  if (!record) throw new TypeError('A record is required.');
  record.id ||= crypto.randomUUID();
  await writeJson(await getRecordHandle(recordsDirectory, record.id, true), record);
}

async function moveRecord(sourcePath, newPath, force) {
  let record = findRecord(sourcePath);
  if (!record) {
    printTerminal(`Record not found: ${sourcePath}`);
    return false;
  }
  if (newPath === sourcePath || isPathInside(newPath, sourcePath)) {
    printTerminal('A record cannot be moved into itself.');
    return false;
  }
  const destination = findRecord(newPath);
  if ((destination && !force) || inferType(newPath) !== record.type) {
    printTerminal(`Invalid destination: ${newPath}`);
    return false;
  }
  const parentPath = normalizePath(newPath.substring(0, newPath.lastIndexOf('/')) || '/');
  if (parentPath !== '/' && !findRecord(parentPath)) {
    printTerminal(`Parent path not found: ${parentPath}`);
    return false;
  }
  if (destination) {
    const replaced = destination.type === 'scene'
      ? [destination]
      : recordArray.filter(item => item.path === newPath || isPathInside(item.path, newPath));
    for (const item of replaced) await deleteRecord(recordDirectory, item.id);
    await refreshRecords();
    record = findRecord(sourcePath);
  }
  // Containers and all descendants receive the same path-prefix replacement.
  for (const item of recordArray.filter(item => item.path === sourcePath || isPathInside(item.path, sourcePath))) {
    item.path = newPath + item.path.slice(sourcePath.length);
    item.parentPath = normalizePath(item.path.substring(0, item.path.lastIndexOf('/')) || '/');
    item.name = item.path.split('/').pop();
    item.updatedAt = new Date().toISOString();
    await saveRecord(recordDirectory, item);
  }
  if (currentPath === sourcePath || isPathInside(currentPath, sourcePath)) {
    currentPath = newPath + currentPath.slice(sourcePath.length);
  }
  await refreshRecords();
  currentRecord = currentRecord ? recordArray.find(item => item.id === currentRecord.id) : null;
  if (currentRecord) setSaveStatus('saved');
  return true;
}

async function loadAllRecords(recordsDirectory) {
  const records = [];
  for await (const handle of recordsDirectory.values()) {
    if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue;
    try {
      records.push(await readJson(handle));
    } catch (error) {
      console.error(`Failed to read record from ${handle.name}:`, error);
    }
  }
  return records;
}

async function deleteRecord(recordsDirectory, id) {
  try {
    await (await getRecordHandle(recordsDirectory, id)).remove();
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
  }
}

