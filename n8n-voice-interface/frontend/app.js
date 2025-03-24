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
    let isListening = false;      // Czy tryb ciągłego nasłuchiwania jest aktywny
    let isRecording = false;      // Czy obecnie nagrywa audio
    let isProcessing = false;     // Czy obecnie przetwarza nagranie
    
    // Obiekty mediów
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingId = 0;          // Unikalny ID dla każdego nagrania
    
    // Zmienne dla wykrywania ciszy
    let audioContext;
    let audioAnalyser;
    let audioSource;
    let microphoneStream;
    let silenceDetectionInterval;
    
    // Ustawienia wykrywania ciszy
    const SILENCE_THRESHOLD = 15; // Próg poniżej którego uznawane jest za ciszę
    const SILENCE_DURATION = 1500; // 1.5 sekundy ciszy do wyzwolenia zatrzymania
    const CHECK_INTERVAL = 100;   // Sprawdzaj co 100ms
    let silenceStartTime = null;
    let speechDetected = false;
    
    // Licznik dla wpisów konwersacji
    let conversationEntryCount = 0;
    const MAX_CONVERSATION_ENTRIES = 10; // Maksymalna liczba wpisów konwersacji do pokazania

    // Sprawdź, czy przeglądarka obsługuje wymagane API
    if (!navigator.mediaDevices || !window.MediaRecorder) {
        statusMessage.textContent = 'Twoja przeglądarka nie obsługuje nagrywania dźwięku.';
        recordButton.disabled = true;
        return;
    }

    // Obsługa kliknięcia przycisku toggle - uruchom/zatrzymaj ciągłe nasłuchiwanie
    recordButton.addEventListener('click', toggleContinuousListening);

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

    // Toggle trybu ciągłego nasłuchiwania
    async function toggleContinuousListening() {
        if (isListening) {
            // Zatrzymaj nasłuchiwanie
            stopListening();
            recordButton.classList.remove('recording');
            recordButton.title = "Rozpocznij ciągłe słuchanie";
            statusMessage.textContent = 'Gotowy do słuchania';
        } else {
            // Rozpocznij nasłuchiwanie
            try {
                await startListening();
                recordButton.classList.add('recording');
                recordButton.title = "Zatrzymaj ciągłe słuchanie";
                statusMessage.textContent = 'Ciągłe słuchanie aktywne...';
                showMessage('Ciągłe słuchanie aktywne. Zacznij mówić, aby wysłać zapytanie.', 'success');
            } catch (error) {
                console.error('Błąd podczas uruchamiania słuchania:', error);
                showMessage(`Nie można uzyskać dostępu do mikrofonu: ${error.message}`, 'error');
            }
        }
    }
    
    // Rozpocznij tryb ciągłego nasłuchiwania
    async function startListening() {
        try {
            // Pobierz strumień mikrofonu
            microphoneStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: 16000
                } 
            });
            
            // Skonfiguruj kontekst audio i analizator
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioSource = audioContext.createMediaStreamSource(microphoneStream);
            audioAnalyser = audioContext.createAnalyser();
            
            // Skonfiguruj analizator
            audioAnalyser.fftSize = 256;
            audioAnalyser.smoothingTimeConstant = 0.8;
            audioSource.connect(audioAnalyser);
            
            // Zresetuj stan wykrywania
            silenceStartTime = null;
            speechDetected = false;
            isListening = true;
            isRecording = false;
            
            // Skonfiguruj rejestrator mediów (ale jeszcze go nie uruchamiaj)
            const mimeType = getSupportedMimeType();
            const options = mimeType ? { mimeType } : {};
            mediaRecorder = new MediaRecorder(microphoneStream, options);
            
            // Rozpocznij wykrywanie ciszy
            startSilenceDetection();
            
            // Uruchom wizualizację
            visualizationContainer.classList.add('active-visualization');
            
            console.log("Tryb ciągłego nasłuchiwania aktywowany");
        } catch (error) {
            console.error("Błąd podczas uruchamiania nasłuchiwania:", error);
            throw error; // Przekaż błąd dalej
        }
    }
    
    // Zatrzymaj tryb ciągłego nasłuchiwania
    function stopListening() {
        // Zatrzymaj wykrywanie ciszy
        clearInterval(silenceDetectionInterval);
        
        // Zatrzymaj aktywne nagrywanie
        if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            isRecording = false;
        }
        
        // Zwolnij mikrofon
        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
        }
        
        // Zamknij kontekst audio
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().catch(e => console.error("Błąd zamykania kontekstu audio:", e));
        }
        
        // Aktualizuj wizualizację
        visualizationContainer.classList.remove('active-visualization');
        
        // Zresetuj flagi
        isListening = false;
        isRecording = false;
        
        console.log("Tryb ciągłego nasłuchiwania dezaktywowany");
    }
    
    // Funkcja do zatrzymywania odtwarzania audio
    function stopAudioPlayback() {
        if (audioPlayer && !audioPlayer.paused) {
            console.log('Przerwanie odtwarzania - wykryto mowę użytkownika');
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            
            // Opcjonalnie: pokaż krótki komunikat
            showMessage('Przerwano odtwarzanie, słucham...', 'success');
            
            // Znajdź i zaktualizuj wszystkie przyciski odtwarzania
            const playButtons = document.querySelectorAll('.play-button');
            playButtons.forEach(button => {
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
            });
        }
    }
    
    // Rozpocznij wykrywanie ciszy
    function startSilenceDetection() {
        // Bufor dla danych częstotliwości
        const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
        
        // Ustaw interwał do sprawdzania mowy i ciszy
        silenceDetectionInterval = setInterval(() => {
            if (!isListening) {
                clearInterval(silenceDetectionInterval);
                return;
            }
            
            // Pobierz aktualne dane częstotliwości
            audioAnalyser.getByteFrequencyData(dataArray);
            
            // Oblicz średnią głośność
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            // Aktualizuj wizualizację (faktyczny poziom dźwięku)
            updateVisualization(average);
            
            // Użytkownik mówi
            if (average > SILENCE_THRESHOLD) {
                // Jeśli odtwarzane jest audio, przerwij odtwarzanie
                stopAudioPlayback();
                
                // Jeśli jeszcze nie nagrywamy, rozpocznij nowe nagranie
                if (!isRecording) {
                    startNewRecording();
                }
                
                // Zresetuj timer ciszy
                silenceStartTime = null;
                speechDetected = true;
            } 
            // Użytkownik milczy
            else {
                // Sprawdź koniec mowy tylko jeśli nagrywamy i mowa została wykryta
                if (isRecording && speechDetected) {
                    // Jeśli to początek ciszy
                    if (silenceStartTime === null) {
                        silenceStartTime = Date.now();
                    }
                    
                    // Sprawdź, czy cisza trwała wystarczająco długo
                    const silenceDuration = Date.now() - silenceStartTime;
                    if (silenceDuration >= SILENCE_DURATION) {
                        console.log(`Cisza wykryta przez ${silenceDuration}ms. Kończę nagrywanie.`);
                        stopCurrentRecording();
                        
                        // Zresetuj dla następnego nagrania
                        speechDetected = false;
                        silenceStartTime = null;
                    }
                }
            }
        }, CHECK_INTERVAL);
    }
    
    // Rozpocznij nowe nagranie
    function startNewRecording() {
        // Zresetuj stan nagrywania
        audioChunks = [];
        recordingId++;
        const currentRecordingId = recordingId;
        
        // Skonfiguruj handlery zdarzeń mediaRecorder
        mediaRecorder.onstart = () => {
            console.log(`Nagrywanie #${currentRecordingId} rozpoczęte`);
            isRecording = true;
        };
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = () => {
            console.log(`Nagrywanie #${currentRecordingId} zakończone`);
            isRecording = false;
            
            // Utwórz blob audio z określonym typem
            const mimeType = getSupportedMimeType();
            const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/mpeg' });
            
            console.log(`Nagranie #${currentRecordingId}: ${audioBlob.size} bajtów`);
            
            // Przetwórz tylko jeśli nie jest za małe
            if (audioBlob.size > 1000) {
                processRecording(audioBlob, `entry-${currentRecordingId}`);
            } else {
                console.log(`Nagranie #${currentRecordingId} zbyt krótkie, pomijam`);
            }
        };
        
        // Rozpocznij nagrywanie w małych kawałkach dla większej responsywności
        mediaRecorder.start(100);
    }
    
    // Zatrzymaj bieżące nagranie
    function stopCurrentRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }
    
    // Przetwórz nagrany blob audio
    async function processRecording(audioBlob, recordingId) {
        const webhookUrl = localStorage.getItem('webhookUrl');
        
        if (!webhookUrl) {
            showMessage('Proszę najpierw ustawić adres URL webhooka N8N w ustawieniach', 'error');
            return;
        }
        
        // Utwórz nowy wpis konwersacji dla tego nagrania
        addConversationEntry(recordingId);
        
        try {
            activeRequests++;
            updateStatus();
            
            // Utwórz dane formularza dla żądania API
            const formData = new FormData();
            formData.append('audio', audioBlob, `recording-${recordingId}.mp3`);
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
            updateConversationEntryWithTranscription(recordingId, data.text);
            
            // Przetwórz odpowiedź z n8n
            if (data.n8nResponse && data.n8nResponse.text) {
                console.log(`Otrzymano natychmiastową odpowiedź dla nagrania #${recordingId}`);
                handleN8nResponse(data.n8nResponse.text, recordingId);
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
                            handleN8nResponse(responseData.text, recordingId, responseData.audio_url);
                        } else {
                            handleDefaultResponse(recordingId);
                        }
                    } else {
                        handleDefaultResponse(recordingId);
                    }
                } catch (error) {
                    console.error(`Błąd podczas pobierania odpowiedzi dla nagrania #${recordingId}:`, error);
                    handleDefaultResponse(recordingId);
                }
            }
        } catch (error) {
            console.error(`Błąd podczas przetwarzania nagrania #${recordingId}:`, error);
            updateConversationEntryWithError(recordingId, error.message);
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
    
    // Aktualizuj wizualizację na podstawie faktycznych poziomów dźwięku
    function updateVisualization(volume) {
        const bars = document.querySelectorAll('.visualization-bar');
        if (!bars.length) return;
        
        // Skaluj głośność do wysokości wizualnej (0-50px)
        const scaledVolume = Math.min(50, volume * 1.5);
        
        // Aktualizuj każdy pasek z lekką losową wariancją dla efektu wizualnego
        bars.forEach(bar => {
            const randomFactor = 0.8 + Math.random() * 0.4;
            const height = Math.max(3, scaledVolume * randomFactor);
            bar.style.height = `${height}px`;
        });
    }

    // Znajdź obsługiwany typ MIME
    function getSupportedMimeType() {
        // Wypróbuj popularne formaty audio w kolejności preferencji
        const mimeTypes = [
            'audio/mp3',
            'audio/mpeg',
            'audio/webm',
            'audio/ogg',
            'audio/wav'
        ];
        
        for (const type of mimeTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log(`Przeglądarka wspiera nagrywanie w formacie ${type}`);
                return type;
            }
        }
        
        console.warn('Żaden z preferowanych typów MIME nie jest obsługiwany przez tę przeglądarkę');
        return null;
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
    document.getElementById('play-again-button')?.addEventListener('click', () => {
        if (audioPlayer.src) {
            audioPlayer.currentTime = 0;
            audioPlayer.play()
                .catch(error => {
                    console.error('Błąd odtwarzania dźwięku:', error);
                    showMessage('Błąd odtwarzania dźwięku', 'error');
                });
        }
    });
    
    // Pokaż początkowy status
    statusMessage.textContent = 'Gotowy do słuchania';
});
