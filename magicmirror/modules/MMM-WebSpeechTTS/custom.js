// Custom test script for MMM-WebSpeechTTS
// This will add a button to the page to test speech functionality

window.addEventListener('load', function() {
    // Create a floating button
    const button = document.createElement('button');
    button.textContent = 'Test Speech';
    button.style.position = 'fixed';
    button.style.bottom = '20px';
    button.style.right = '20px';
    button.style.zIndex = '9999';
    button.style.padding = '10px 20px';
    button.style.backgroundColor = '#333';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '5px';
    button.style.cursor = 'pointer';

    // Add click handler
    button.addEventListener('click', function() {
        if (window.mmmWebSpeechTts && typeof window.mmmWebSpeechTts.say === 'function') {
            // Use the module's API
            window.mmmWebSpeechTts.say({
                text: "This is a test of the speech synthesis system. If you can hear this, the system is working correctly."
            });
            console.log("Speech test triggered via MMM-WebSpeechTTS API");
        } else {
            // Fallback to native speech API
            console.log("MMM-WebSpeechTTS API not found, using native SpeechSynthesis");
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(
                    "This is a test using the browser's built-in speech synthesis."
                );
                speechSynthesis.speak(utterance);
                console.log("Native speech synthesis triggered");
            } else {
                console.error("Speech synthesis is not supported in this browser");
                alert("Speech synthesis is not supported in this browser");
            }
        }
    });

    // Add to document
    document.body.appendChild(button);

    // Create a status div to show speech availability
    const statusDiv = document.createElement('div');
    statusDiv.style.position = 'fixed';
    statusDiv.style.bottom = '80px';
    statusDiv.style.right = '20px';
    statusDiv.style.zIndex = '9999';
    statusDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
    statusDiv.style.color = 'white';
    statusDiv.style.padding = '10px';
    statusDiv.style.borderRadius = '5px';

    if ('speechSynthesis' in window) {
        statusDiv.textContent = 'Speech API Available';
        statusDiv.style.backgroundColor = 'rgba(0,128,0,0.7)';

        // List voices
        let voices = speechSynthesis.getVoices();
        if (voices.length === 0) {
            // If voices aren't loaded yet, wait for them
            speechSynthesis.onvoiceschanged = function() {
                voices = speechSynthesis.getVoices();
                console.log('Available voices:', voices.map(v => `${v.name} (${v.lang})`).join(', '));
            };
        } else {
            console.log('Available voices:', voices.map(v => `${v.name} (${v.lang})`).join(', '));
        }
    } else {
        statusDiv.textContent = 'Speech API NOT Available';
        statusDiv.style.backgroundColor = 'rgba(255,0,0,0.7)';
    }

    document.body.appendChild(statusDiv);

    // Check for MMM-WebSpeechTTS module
    if (window.mmmWebSpeechTts) {
        console.log('MMM-WebSpeechTTS module detected');
    } else {
        console.log('MMM-WebSpeechTTS module not detected or not loaded');
    }
});
