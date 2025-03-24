document.addEventListener('DOMContentLoaded', () => {
    // Referencje do elementów DOM
    const recordButton = document.getElementById('record-button');
    const statusMessage = document.getElementById('status-message');
    const visualizationContainer = document.getElementById('visualization-container');
    const transcriptionContainer = document.getElementById('transcription-container');
    const transcriptionText = document.getElementById('transcription-text');
    const messageContainer = document.getElementById('message-container');
    const messageText = document.getElementById('message-text');
    const webhookUrlInput = document.getElementById('webhook-url');
    const saveSettingsButton = document.getElementById('save-settings');
    const responseContainer = document.getElementById('response-container');
    const responseText = document.getElementById('response-text');
    const conversationContainer = document.getElementById('conversation-container');
    
    // Audio player dla odpowiedzi
    let audioPlayer = new Audio();
    
    // Śledzenie stanu
    let activeRequests = 0;
    
    // Wczytaj zapisany URL webhooka z localStorage
    webhookUrlInput.value = localStorage.getItem('webhookUrl') || '';

    // Flagi dla trybu ciągłego nasłuchiwania
    let isListening = false;     
    let isRecording = false;     
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingId = 0;         
    
    // Zmienne dla obsługi dźwięku
    let microphoneStream = null;
    let silenceDetectionInterval = null;
    
    // Ustawienia wykrywania ciszy
    const SILENCE_THRESHOLD = 15; 
    const SILENCE_DURATION = 1500;
    const CHECK_INTERVAL = 100;   
    let silenceStartTime = null;
    let speechDetected = false;
    
    // Licznik dla wpisów konwersacji
    const MAX_CONVERSATION_ENTRIES = 10;

    // Sprawdź, czy przeglądarka obsługuje wymagane API
    if (!navigator.mediaDevices) {
        statusMessage.textContent = 'Twoja przeglądarka nie obsługuje API dostępu do mikrofonu.';
        recordButton.disabled = true;
        return;
    }

    // Obsługa kliknięcia przycisku toggle
    recordButton.addEventListener('click', async () => {
        try {
            if (isListening) {
                // Zatrzymaj nasłuchiwanie
                stopListening();
                recordButton.classList.remove('recording');
                recordButton.title = "Rozpocznij ciągłe słuchanie";
                statusMessage.textContent = 'Gotowy do słuchania';
            } else {
                // Rozpocznij nasłuchiwanie
                await startListening();
                recordButton.classList.add('recording');
                recordButton.title = "Zatrzymaj ciągłe słuchanie";
                statusMessage.textContent = 'Ciągłe słuchanie aktywne...';
                showMessage('Ciągłe słuchanie aktywne. Zacznij mówić, aby wysłać zapytanie.', 'success');
            }
        } catch (error) {
            console.error('Błąd podczas przełączania słuchania:', error);
            showMessage(`Nie można uzyskać dostępu do mikrofonu: ${error.message}`, 'error');
        }
    });
    
    // Zapisz URL webhooka do localStorage
    saveSettingsButton.addEventListener('click', () => {
        const webhookUrl = webhookUrlInput.value.trim();
        if (webhookUrl) {
            localStorage.setItem('webhookUrl', webhookUrl);
            showMessage('Ustawienia zapisane pomyślnie!', 'success');
        } else {
            showMessage('Proszę wprowadzić poprawny adres URL webhooka', 'error');
        }
    });

    // Rozpocznij tryb ciągłego nasłuchiwania
    async function startListening() {
        try {
            // Najprostsza możliwa konfiguracja mikrofonu
            microphoneStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true 
            });
            
            // Zresetuj stan
            isListening = true;
            isRecording = false;
            silenceStartTime = null;
            speechDetected = false;
            
            // Najprostsza konfiguracja MediaRecorder
            mediaRecorder = new MediaRecorder(microphoneStream);
            
            // Skonfiguruj obsługę zdarzeń
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstart = () => {
                isRecording = true;
                console.log("Nagrywanie rozpoczęte");
            };
            
            mediaRecorder.onstop = () => {
                isRecording = false;
                console.log("Nagrywanie zakończone");
                
                // Przetwórz nagranie
                const audioBlob = new Blob(audioChunks, { type: 'audio/mpeg' });
                if (audioBlob.size > 1000) {
                    processRecording(audioBlob);
                }
                
                // Zresetuj chunki
                audioChunks = [];
            };
            
            // Uruchom wizualizację
            visualizationContainer.classList.add('active-visualization');
            
            // Ustaw interwał nasłuchiwania (uproszczone wykrywanie dźwięku)
            startSimpleVoiceDetection();
            
            console.log("Tryb ciągłego nasłuchiwania aktywowany");
        } catch (error) {
            console.error("Błąd podczas uruchamiania nasłuchiwania:", error);
            throw error;
        }
    }
    
    // Prosta detekcja dźwięku bez AudioContext (dla kompatybilności)
    function startSimpleVoiceDetection() {
        // Zacznij od razu nagrywać (rozpocznij od razu słuchanie)
        startNewRecording();
        
        // Ustaw interwał do aktualizacji wizualizacji (atrapa)
        silenceDetectionInterval = setInterval(() => {
            // Prosta animacja pulsowania dla wizualizacji
            const bars = document.querySelectorAll('.visualization-bar');
            bars.forEach(bar => {
                const height = 3 + Math.random() * 10;
                bar.style.height = `${height}px`;
            });
        }, 100);
    }
    
    // Zatrzymaj tryb ciągłego nasłuchiwania
    function stopListening() {
        // Zatrzymaj wszystkie interwały
        clearInterval(silenceDetectionInterval);
        
        // Zatrzymaj nagrywanie
        if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        
        // Zwolnij mikrofon
        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
        }
        
        // Aktualizuj wizualizację
        visualizationContainer.classList.remove('active-visualization');
        
        // Zresetuj flagi
        isListening = false;
        isRecording = false;
        
        console.log("Tryb ciągłego nasłuchiwania dezaktywowany");
    }
    
    // Rozpocznij nowe nagranie
    function startNewRecording() {
        // Zresetuj stan nagrywania
        audioChunks = [];
        recordingId++;
        
        // Rozpocznij nagrywanie
        if (mediaRecorder && mediaRecorder.state !== 'recording') {
            try {
                mediaRecorder.start(1000); // Zapisuj dane co 1 sekundę
            } catch (error) {
                console.error("Błąd podczas rozpoczynania nagrywania:", error);
            }
        }
    }
    
    // Przetwórz nagrany blob audio
    async function processRecording(audioBlob) {
        const webhookUrl = localStorage.getItem('webhookUrl');
        
        if (!webhookUrl) {
            showMessage('Proszę najpierw ustawić adres URL webhooka N8N w ustawieniach', 'error');
            return;
        }
        
        // Utwórz nowy wpis konwersacji
        const entryId = `entry-${Date.now()}`;
        addConversationEntry(entryId);
        
        try {
            activeRequests++;
            updateStatus();
            
            // Utwórz dane formularza dla żądania API
            const formData = new FormData();
            formData.append('audio', audioBlob, `recording-${entryId}.mp3`);
            formData.append('webhook_url', webhookUrl);
            
            // Wyślij audio do backendu
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                let errorMessage = 'Transkrypcja nie powiodła się';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorMessage;
                } catch (e) {
                    console.error('Błąd parsowania odpowiedzi błędu:', e);
                }
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            
            // Aktualizuj wpis konwersacji transkrypcją
            updateConversationEntryWithTranscription(entryId, data.text);
            
            // Przetwórz odpowiedź z n8n
            if (data.n8nResponse && data.n8nResponse.text) {
                console.log(`Otrzymano natychmiastową odpowiedź`);
                handleN8nResponse(data.n8nResponse.text, entryId);
            } else {
                // Spróbuj pobrać odpowiedź przez endpoint last-response-tts
                try {
                    const n8nResponse = await fetch('/api/last-response-tts', {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                        },
                    });
                    
                    if (n8nResponse.ok) {
                        const responseData = await n8nResponse.json();
                        
                        if (responseData.text && responseData.audio_url) {
                            handleN8nResponse(responseData.text, entryId, responseData.audio_url);
                        } else {
                            handleDefaultResponse(entryId);
                        }
                    } else {
                        handleDefaultResponse(entryId);
                    }
                } catch (error) {
                    console.error(`Błąd podczas pobierania odpowiedzi:`, error);
                    handleDefaultResponse(entryId);
                }
            }
            
            // Po zakończeniu przetwarzania, rozpocznij nowe nagrywanie
            if (isListening && !isRecording) {
                setTimeout(() => {
                    startNewRecording();
                }, 500);
            }
        } catch (error) {
            console.error(`Błąd podczas przetwarzania nagrania:`, error);
            updateConversationEntryWithError(entryId, error.message);
            
            // Spróbuj ponownie rozpocząć nagrywanie po błędzie
            if (isListening && !isRecording) {
                setTimeout(() => {
                    startNewRecording();
                }, 1000);
            }
        } finally {
            activeRequests--;
            updateStatus();
        }
    }
    
    // Obsługa odpowiedzi n8n
    async function handleN8nResponse(text, entryId, audioUrl = null) {
        try {
            if (!audioUrl) {
                // Konwertuj tekst na mowę
                const response = await fetch('/api/speak', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text: text })
                });
                
                if (!response.ok) {
                    throw new Error('Nie udało się przekonwertować tekstu na mowę');
                }
                
                const responseData = await response.json();
                audioUrl = responseData.audio_url;
            }
            
            // Aktualizuj wpis konwersacji odpowiedzią
            updateConversationEntryWithResponse(entryId, text, audioUrl);
            
            // Odtwórz audio
            playAudioResponse(audioUrl);
            
        } catch (error) {
            console.error('Błąd podczas obsługi odpowiedzi:', error);
            updateConversationEntryWithError(entryId, error.message);
        }
    }
    
    // Obsługa domyślnej odpowiedzi, gdy n8n zawiedzie
    function handleDefaultResponse(entryId) {
        const defaultText = "Niestety, nie mogę przetworzyć tej prośby w tej chwili. Czy mogę pomóc w czymś innym?";
        handleN8nResponse(defaultText, entryId);
    }
    
    // Utwórz nowy wpis konwersacji
    function addConversationEntry(entryId) {
        // Sprawdź, czy mamy zbyt wiele wpisów i usuń najstarszy
        const entries = conversationContainer.querySelectorAll('.conversation-entry');
        if (entries.length >= MAX_CONVERSATION_ENTRIES) {
            conversationContainer.removeChild(entries[0]);
        }
        
        // Utwórz nowy wpis
        const entryHtml = `
            <div id="${entryId}" class="conversation-entry">
                <div class="user-message">
                    <div class="message-status">Przetwarzanie...</div>
                    <div class="message-content loading"></div>
                </div>
                <div class="assistant-message hidden">
                    <div class="message-content"></div>
                    <div class="audio-controls hidden">
                        <button class="play-button btn-icon">
                            <i class="fas fa-play"></i> Odtwórz
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Dodaj do kontenera - na dole
        conversationContainer.insertAdjacentHTML('beforeend', entryHtml);
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
        
        // Upewnij się, że kontener jest widoczny
        conversationContainer.classList.remove('hidden');
    }
    
    // Aktualizuj wpis konwersacji transkrypcją
    function updateConversationEntryWithTranscription(entryId, text) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const messageStatus = entry.querySelector('.user-message .message-status');
        const messageContent = entry.querySelector('.user-message .message-content');
        
        messageStatus.textContent = 'Ty:';
        messageContent.textContent = text;
        messageContent.classList.remove('loading');
    }
    
    // Aktualizuj wpis konwersacji odpowiedzią
    function updateConversationEntryWithResponse(entryId, text, audioUrl) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const assistantMessage = entry.querySelector('.assistant-message');
        const messageContent = assistantMessage.querySelector('.message-content');
        const audioControls = assistantMessage.querySelector('.audio-controls');
        const playButton = audioControls.querySelector('.play-button');
        
        messageContent.textContent = text;
        assistantMessage.classList.remove('hidden');
        audioControls.classList.remove('hidden');
        
        // Skonfiguruj przycisk odtwarzania
        playButton.addEventListener('click', () => {
            playAudioResponse(audioUrl, playButton);
        });
        
        // Przewiń, aby pokazać nową zawartość
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
    
    // Aktualizuj wpis konwersacji błędem
    function updateConversationEntryWithError(entryId, errorText) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const messageStatus = entry.querySelector('.user-message .message-status');
        const messageContent = entry.querySelector('.user-message .message-content');
        
        messageStatus.textContent = 'Błąd:';
        messageStatus.style.color = 'red';
        messageContent.textContent = errorText;
        messageContent.classList.remove('loading');
    }
    
    // Aktualizuj wiadomość o statusie
    function updateStatus() {
        if (!isListening) {
            statusMessage.textContent = 'Gotowy do słuchania';
            return;
        }
        
        if (activeRequests > 0) {
            statusMessage.textContent = `Ciągłe słuchanie aktywne... (${activeRequests} ${activeRequests === 1 ? 'zapytanie' : 'zapytania'} w toku)`;
        } else {
            statusMessage.textContent = 'Ciągłe słuchanie aktywne...';
        }
    }
    
    // Funkcja do odtwarzania odpowiedzi audio
    function playAudioResponse(audioUrl, buttonElement = null) {
        // Zatrzymaj aktualnie odtwarzane audio
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        
        // Upewnij się, że URL jest absolutny
        const absoluteUrl = audioUrl.startsWith('http') ? audioUrl : window.location.origin + audioUrl;
        
        // Ustaw nowe źródło audio
        audioPlayer.src = absoluteUrl;
        
        // Aktualizuj stan przycisku, jeśli podany
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.innerHTML = '<i class="fas fa-volume-up"></i> Odtwarzanie...';
            
            // Zresetuj przycisk po zakończeniu odtwarzania
            audioPlayer.onended = () => {
                console.log('Odtwarzanie dźwięku zakończone');
                buttonElement.disabled = false;
                buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
            };
        }
        
        // Odtwórz audio
        audioPlayer.play()
            .catch(error => {
                console.error('Błąd odtwarzania dźwięku:', error);
                showMessage('Błąd odtwarzania odpowiedzi dźwiękowej', 'error');
                
                // Zresetuj przycisk przy błędzie
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
                }
            });
    }

    // Funkcja pomocnicza do pokazywania wiadomości
    function showMessage(message, type) {
        messageText.textContent = message;
        messageContainer.classList.remove('hidden', 'success', 'error');
        messageContainer.classList.add(type);
        
        // Auto-ukryj po 5 sekundach
        setTimeout(() => {
            hideMessage();
        }, 5000);
    }

    // Funkcja pomocnicza do ukrywania wiadomości
    function hideMessage() {
        messageContainer.classList.add('hidden');
    }

    // Dodaj obsługę zdarzenia dla przycisku "Odtwórz ponownie"
    const playAgainButton = document.getElementById('play-again-button');
    if (playAgainButton) {
        playAgainButton.addEventListener('click', () => {
            if (audioPlayer.src) {
                audioPlayer.currentTime = 0;
                audioPlayer.play()
                    .catch(error => {
                        console.error('Błąd odtwarzania dźwięku:', error);
                        showMessage('Błąd odtwarzania dźwięku', 'error');
                    });
            }
        });
    }
    
    // Pokaż początkowy status
    statusMessage.textContent = 'Gotowy do słuchania';
});
