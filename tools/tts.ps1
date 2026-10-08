# NIGHT SHIFT — renders the scripted dialogue with the offline Windows SAPI voices.
# Output: blender/audio_src/voice/*.wav (raw TTS). Blender then distorts/filters these
# and encodes the shipped files in public/assets/audio/voice/.
# Run: powershell -ExecutionPolicy Bypass -File tools/tts.ps1
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot '..\blender\audio_src\voice'
New-Item -ItemType Directory -Force $out | Out-Null
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function Render($name, $voice, $ssmlBody) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($voice)
  $path = Join-Path $out "$name.wav"
  $s.SetOutputToWaveFile($path, $fmt)
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>$ssmlBody</speak>"
  $s.SpeakSsml($ssml)
  $s.SetOutputToNull()
  $s.Dispose()
  Write-Output "$name -> $((Get-Item $path).Length) bytes"
}

$male = 'Microsoft David Desktop'
$female = 'Microsoft Zira Desktop'
$uk = 'Microsoft Hazel Desktop'

Render 'phone_threat' $male "<prosody rate='-35%' pitch='x-low'>I will kill you<break time='700ms'/>tonight.</prosody>"
Render 'phone_laugh' $male "<prosody rate='-45%' pitch='x-low'>heh<break time='250ms'/>heh heh<break time='180ms'/>hah. hah. hah<break time='120ms'/>hah, hah, hahh.</prosody>"
Render 'turned_on' $male "<prosody rate='-30%' pitch='x-low'>You turned it<break time='250ms'/>back on.</prosody>"
Render 'not_first' $male "<prosody rate='-30%' pitch='low'>You're not<break time='200ms'/>the first.</prosody>"
Render 'see_tonight' $male "<prosody rate='-35%' pitch='low'>See you<break time='350ms'/>tonight.</prosody>"
Render 'pa_over' $uk "<prosody rate='-15%' pitch='medium'>Night shift<break time='150ms'/>is over.</prosody>"
Render 'pa_morning' $uk "<prosody rate='-15%' pitch='medium'>Morning staff will arrive at<break time='120ms'/>six A M.</prosody>"
Render 'whisper_src' $female "<prosody rate='-20%' pitch='low'>come down<break time='400ms'/>come down to us<break time='500ms'/>it's so cold<break time='400ms'/>stay<break time='300ms'/>stay with us</prosody>"
