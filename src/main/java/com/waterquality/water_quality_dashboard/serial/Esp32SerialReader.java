
package com.waterquality.water_quality_dashboard.serial;

import com.fazecast.jSerialComm.SerialPort;
import com.waterquality.water_quality_dashboard.model.WaterReading;
import com.waterquality.water_quality_dashboard.repository.WaterReadingRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;

@Component
public class Esp32SerialReader {

    private static final String PORT_NAME = "COM5";
    private static final int BAUD_RATE = 115200;
    private static final int READ_TIMEOUT_MS = 1000;
    private static final int RECONNECT_DELAY_MS = 2000;
    private static final long SAVE_INTERVAL_MS = 5000;

    private final WaterReadingRepository repository;
    private final ObjectMapper objectMapper;

    private volatile boolean running = true;
    private volatile SerialPort serialPort;
    private Thread readerThread;

    private long lastSavedTime = 0;

    public Esp32SerialReader(
            WaterReadingRepository repository,
            ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void startReader() {
        readerThread = new Thread(
                this::readSerialData,
                "esp32-serial-reader"
        );

        readerThread.setDaemon(true);
        readerThread.start();
    }

    private void readSerialData() {
        while (running) {
            SerialPort port = SerialPort.getCommPort(PORT_NAME);
            serialPort = port;

            port.setBaudRate(BAUD_RATE);
            port.setNumDataBits(8);
            port.setNumStopBits(SerialPort.ONE_STOP_BIT);
            port.setParity(SerialPort.NO_PARITY);

            port.setComPortTimeouts(
                    SerialPort.TIMEOUT_READ_SEMI_BLOCKING,
                    READ_TIMEOUT_MS,
                    0
            );

            try {
                if (!port.openPort()) {
                    System.err.println(
                            "Cannot open " + PORT_NAME
                                    + ". Retrying..."
                    );

                    pauseBeforeRetry();
                    continue;
                }

                System.out.println(
                        "ESP32 connected on " + PORT_NAME
                );

                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(port.getInputStream()))) {

                    while (running && port.isOpen()) {
                        String line;

                        try {
                            line = reader.readLine();
                        } catch (IOException e) {
                            if (!running) {
                                break;
                            }

                            if (isTimeout(e)) {
                                continue;
                            }

                            throw e;
                        }

                        if (line == null || !line.startsWith("DATA:")) {
                            continue;
                        }

                        long currentTime = System.currentTimeMillis();

                        if (currentTime - lastSavedTime
                                < SAVE_INTERVAL_MS) {
                            continue;
                        }

                        String json = line.substring(5).trim();

                        try {
                            WaterReading reading =
                                    objectMapper.readValue(
                                            json,
                                            WaterReading.class
                                    );

                            repository.save(reading);

                            lastSavedTime = System.currentTimeMillis();

                            System.out.println(
                                    "Reading saved to MySQL: " + json
                            );

                        } catch (Exception e) {
                            System.err.println(
                                    "Reading processing failed: "
                                            + e.getMessage()
                            );
                        }
                    }
                }

            } catch (Exception e) {
                if (running) {
                    System.err.println(
                            "Serial connection error: "
                                    + e.getMessage()
                    );
                }

            } finally {
                if (port.isOpen()) {
                    port.closePort();
                }

                if (serialPort == port) {
                    serialPort = null;
                }
            }

            if (running) {
                pauseBeforeRetry();
            }
        }
    }

    private boolean isTimeout(IOException e) {
        String message = e.getMessage();

        return message != null
                && message.toLowerCase().contains("timed out");
    }

    private void pauseBeforeRetry() {
        try {
            Thread.sleep(RECONNECT_DELAY_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            running = false;
        }
    }

    @PreDestroy
    public void stopReader() {
        running = false;

        if (readerThread != null) {
            readerThread.interrupt();
        }

        SerialPort port = serialPort;

        if (port != null && port.isOpen()) {
            port.closePort();
        }
    }
}
