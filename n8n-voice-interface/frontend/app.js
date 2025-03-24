document.addEventListener('DOMContentLoaded', () => {
    // Elementy DOM
    const recordButton = document.getElementById('record-button');
    const statusMessage = document.getElementById('status-message');
    const messageContainer = document.getElementById('message-container');
    const messageText = document.getElementById('message-text');
    const webhookUrlInput = document.getElementById('webhook-url');
    const saveSettingsButton = document.getElementById('save-settings');
    const conversationContainer = document.getElementById('conversation-container');
    
    // Audio player dla odpowiedzi
    let audioPlayer = new Audio();
    
    // Wczytaj zapisany URL webhooka z localStorage
    webhookUrlInput.value = localStorage.getItem('webhookUrl') || '';

    // Zmienne stanu
    let isRecording = false;
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingId = 0;
    let microphoneStream = null;
    
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

    // Obsługa przycisku nagrywania (naciśnij i przytrzymaj)
    recordButton.addEventListener('mousedown', startRecording);
    recordButton.addEventListener('touchstart', startRecording);
    recordButton.addEventListener('mouseup', stopRecording);
    recordButton.addEventListener('touchend', stopRecording);
    recordButton.addEventListener('mouseleave', stopRecording);
    
    // Funkcja uruchamiająca nagrywanie
    async function startRecording() {
        try {
            // Sprawdź, czy URL webhooka jest ustawiony
            const webhookUrl = localStorage.getItem('webhookUrl');
            if (!webhookUrl) {
                showMessage('Proszę najpierw ustawić adres URL webhooka N8N w ustawieniach', 'error');
                return;
            }
            
            // Inicjalizacja nagrywania tylko jeśli jeszcze nie nagrywamy
            if (!isRecording) {
                // Resetujemy chunki audio
                audioChunks = [];
                
                // Pobierz strumień audio z mikrofonu
                microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // Utwórz MediaRecorder z najbardziej kompatybilnym formatem
                let mimeType = 'audio/webm';
                if (MediaRecorder.isTypeSupported('audio/webm')) {
                    mimeType = 'audio/webm';
                } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                    mimeType = 'audio/mp4';
                } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                    mimeType = 'audio/ogg';
                }
                
                mediaRecorder = new MediaRecorder(microphoneStream, { mimeType });
                
                // Nasłuchuj zdarzenia dataavailable, aby zbierać chunki audio
                mediaRecorder.addEventListener('dataavailable', event => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                    }
                });
                
                // Rozpocznij nagrywanie
                mediaRecorder.start();
                isRecording = true;
                recordingId++;
                
                // Aktualizuj interfejs
                recordButton.classList.add('recording');
                statusMessage.textContent = 'Nagrywanie... Puść przycisk, aby zatrzymać.';
            }
        } catch (error) {
            console.error('Błąd podczas rozpoczynania nagrywania:', error);
            showMessage('Nie można uzyskać dostępu do mikrofonu: ' + error.message, 'error');
        }
    }
    
    // Funkcja zatrzymująca nagrywanie
    async function stopRecording() {
        if (isRecording && mediaRecorder) {
            try {
                // Zatrzymaj nagrywanie
                mediaRecorder.stop();
                isRecording = false;
                
                // Aktualizuj interfejs
                recordButton.classList.remove('recording');
                statusMessage.textContent = 'Przetwarzanie nagrania...';
                
                // Zaczekaj na zakończenie nagrywania i przetwórz je
                setTimeout(() => {
                    const entryId = `entry-${recordingId}`;
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    if (audioBlob.size > 0) {
                        processRecording(audioBlob, entryId);
                    } else {
                        statusMessage.textContent = 'Gotowy do nagrywania';
                        showMessage('Nagranie jest puste', 'error');
                    }
                    
                    // Zamknij strumień mikrofonu
                    if (microphoneStream) {
                        microphoneStream.getTracks().forEach(track => track.stop());
                        microphoneStream = null;
                    }
                }, 500);
            } catch (error) {
                console.error('Błąd podczas zatrzymywania nagrywania:', error);
                statusMessage.textContent = 'Gotowy do nagrywania';
                showMessage('Błąd podczas zatrzymywania nagrywania: ' + error.message, 'error');
            }
        }
    }
    
    // Przetwarzanie nagrania
    async function processRecording(audioBlob, entryId) {
        try {
            const webhookUrl = localStorage.getItem('webhookUrl');
            
            // Dodaj wpis konwersacji
            addConversationEntry(entryId);
            
            // Utwórz FormData do wysłania pliku audio
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('webhook_url', webhookUrl);
            
            // Wyślij plik do backendu
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                let errorMessage = 'Transkrypcja nie powiodła się';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorMessage;
                } catch (e) {}
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            
            // Aktualizuj wpis konwersacji transkrypcją
            updateConversationEntryWithTranscription(entryId, data.text);
            
            // Obsłuż odpowiedź n8n
            if (data.n8nResponse && data.n8nResponse.text) {
                handleN8nResponse(data.n8nResponse.text, entryId);
            } else {
                // Pobierz ostatnią odpowiedź
                try {
                    const n8nResponse = await fetch('/api/last-response-tts');
                    if (n8nResponse.ok) {
                        const responseData = await n8nResponse.json();
                        if (responseData.text) {
                            handleN8nResponse(responseData.text, entryId, responseData.audio_url);
                        } else {
                            handleDefaultResponse(entryId);
                        }
                    } else {
                        handleDefaultResponse(entryId);
                    }
                } catch (error) {
                    handleDefaultResponse(entryId);
                }
            }
            
            // Aktualizuj status
            statusMessage.textContent = 'Gotowy do nagrywania';
            
        } catch (error) {
            console.error('Błąd przetwarzania nagrania:', error);
            updateConversationEntryWithError(entryId, error.message);
            statusMessage.textContent = 'Gotowy do nagrywania';
        }
    }
    
    // Funkcje obsługi konwersacji
    function addConversationEntry(entryId) {
        // Usuń najstarsze wpisy, jeśli mamy ich za dużo
        const entries = conversationContainer.querySelectorAll('.conversation-entry');
        if (entries.length >= 10) {
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
        
        conversationContainer.insertAdjacentHTML('beforeend', entryHtml);
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
        conversationContainer.classList.remove('hidden');
    }
    
    function updateConversationEntryWithTranscription(entryId, text) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const messageStatus = entry.querySelector('.user-message .message-status');
        const messageContent = entry.querySelector('.user-message .message-content');
        
        messageStatus.textContent = 'Ty:';
        messageContent.textContent = text;
        messageContent.classList.remove('loading');
    }
    
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
        
        // Ustaw przycisk odtwarzania
        playButton.addEventListener('click', () => {
            playAudioResponse(audioUrl, playButton);
        });
        
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
    
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
    
    // Obsługa odpowiedzi n8n
    async function handleN8nResponse(text, entryId, audioUrl = null) {
        try {
            if (!audioUrl) {
                // Konwertuj tekst na mowę
                const response = await fetch('/api/speak', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text })
                });
                
                if (response.ok) {
                    const responseData = await response.json();
                    audioUrl = responseData.audio_url;
                } else {
                    throw new Error('Nie udało się przekonwertować tekstu na mowę');
                }
            }
            
            // Aktualizuj wpis konwersacji
            updateConversationEntryWithResponse(entryId, text, audioUrl);
            
            // Odtwórz audio
            playAudioResponse(audioUrl);
            
        } catch (error) {
            console.error('Błąd obsługi odpowiedzi n8n:', error);
            updateConversationEntryWithError(entryId, error.message);
        }
    }
    
    function handleDefaultResponse(entryId) {
        const defaultText = "Nie mogę przetworzyć tej prośby w tej chwili. Czy mogę pomóc w czymś innym?";
        handleN8nResponse(defaultText, entryId);
    }
    
    // Odtwarzanie audio
    function playAudioResponse(audioUrl, buttonElement = null) {
        try {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            
            const absoluteUrl = audioUrl.startsWith('http') ? audioUrl : window.location.origin + audioUrl;
            audioPlayer.src = absoluteUrl;
            
            if (buttonElement) {
                buttonElement.disabled = true;
                buttonElement.innerHTML = '<i class="fas fa-volume-up"></i> Odtwarzanie...';
                
                audioPlayer.onended = () => {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
                };
            }
            
            audioPlayer.play().catch(error => {
                console.error('Błąd odtwarzania audio:', error);
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
                }
            });
        } catch (error) {
            console.error('Błąd odtwarzania audio:', error);
        }
    }
    
    // Funkcja pomocnicza do wyświetlania wiadomości
    function showMessage(message, type) {
        messageText.textContent = message;
        messageContainer.classList.remove('hidden', 'success', 'error');
        messageContainer.classList.add(type);
        
        setTimeout(() => {
            messageContainer.classList.add('hidden');
        }, 5000);
    }
    
    // Inicjalizacja statusu
    statusMessage.textContent = 'Gotowy do nagrywania';
    showMessage('Naciśnij i przytrzymaj przycisk mikrofonu, aby nagrywać', 'success');
});
