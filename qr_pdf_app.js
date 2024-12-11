require("dotenv").config();

const express = require("express");
const sharp = require("sharp");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple logging utility that writes to stdout/stderr for PM2
const logger = {
    info: (message, meta = {}) => {
        console.log(
            JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "info",
                message,
                ...meta,
            })
        );
    },
    debug: (message, meta = {}) => {
        console.log(
            JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "debug",
                message,
                ...meta,
            })
        );
    },
    warn: (message, meta = {}) => {
        console.warn(
            JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "warn",
                message,
                ...meta,
            })
        );
    },
    error: (message, meta = {}) => {
        console.error(
            JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "error",
                message,
                ...meta,
            })
        );
    },
};

// Path to template file
const TEMPLATE_PATH = path.join(
    __dirname,
    "assets",
    "template-white-elegant.png"
);
const QR_SIZE = 384; // Fixed QR code size

logger.info("Starting application with configuration", {
    port: port,
    templatePath: TEMPLATE_PATH,
    qrSize: QR_SIZE,
    authConfigured: !!process.env.AUTH_SECRET,
});

// Health check endpoint
app.get("/", (req, res) => {
    logger.info("Health check endpoint accessed");
    res.send(
        "QR PDF Generator is running. Use POST /generate-qr-pdf to generate PDFs."
    );
});

// Generate QR code from URL
async function generateQRCode(url) {
    try {
        const qrBuffer = await QRCode.toBuffer(url, {
            errorCorrectionLevel: "H",
            margin: 1,
            width: QR_SIZE,
            color: {
                dark: "#000000",
                light: "#ffffff",
            },
        });

        return qrBuffer;
    } catch (error) {
        logger.error("Error generating QR code", {
            error: error.message,
            url,
        });
        throw new Error("Failed to generate QR code");
    }
}

// Main PDF generation endpoint
app.post("/generate-qr-pdf", async (req, res) => {
    const requestId = Date.now().toString();
    logger.info("Starting new PDF generation request", { requestId });

    try {
        logger.debug("Raw request body received", {
            requestId,
            body: req.body,
        });

        const { url, authSecret } = req.body;
        logger.debug("Request parameters received", {
            requestId,
            urlProvided: !!url,
            authSecretProvided: !!authSecret,
        });

        // Validate all required parameters
        if (!url || !authSecret) {
            logger.warn("Validation failed - missing parameters", {
                requestId,
                url: url ? "provided" : "missing",
                authSecret: authSecret ? "provided" : "missing",
            });
            return res.status(400).json({
                error: "Missing required parameters",
                details: {
                    url: url ? "provided" : "missing",
                    authSecret: authSecret ? "provided" : "missing",
                },
            });
        }

        // Validate authSecret
        logger.debug("Validating auth secret", { requestId });
        if (authSecret !== process.env.AUTH_SECRET) {
            logger.warn("Authentication failed - invalid secret", {
                requestId,
            });
            return res
                .status(401)
                .json({ error: "Invalid authentication secret" });
        }
        logger.debug("Auth secret validated successfully", { requestId });

        // Generate QR code
        logger.debug("Generating QR code", { requestId, url });
        const qrCodeBuffer = await generateQRCode(url);
        logger.debug("QR code generated successfully", { requestId });

        // Load the template image
        logger.debug("Loading template image", { requestId });
        const templateBuffer = await sharp(TEMPLATE_PATH).toBuffer();
        logger.debug("Template image loaded successfully", { requestId });

        // Get template dimensions
        const templateMetadata = await sharp(templateBuffer).metadata();
        const { width: templateWidth, height: templateHeight } =
            templateMetadata;
        logger.debug("Template dimensions obtained", {
            requestId,
            width: templateWidth,
            height: templateHeight,
        });

        // Calculate overlay position
        const qrOverlay = {
            input: qrCodeBuffer,
            top: 481,
            left: Math.round((templateWidth - QR_SIZE) / 2),
        };
        logger.debug("QR code position calculated", {
            requestId,
            position: { top: qrOverlay.top, left: qrOverlay.left },
        });

        // Create processed image
        logger.debug("Compositing images", { requestId });
        const processedImage = await sharp(templateBuffer)
            .composite([qrOverlay])
            .toBuffer();
        logger.debug("Image composition completed", { requestId });

        // Create PDF
        logger.debug("Creating PDF document", { requestId });
        const doc = new PDFDocument({
            size: [templateWidth, templateHeight],
            margin: 0,
        });

        // Set response headers
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=qr-instructions.pdf"
        );

        // Pipe the PDF to the response
        doc.pipe(res);

        // Add the processed image
        logger.debug("Adding image to PDF", { requestId });
        doc.image(processedImage, 0, 0, {
            width: templateWidth,
            height: templateHeight,
        });

        // Add URL text
        const fontSize = Math.round(templateWidth * 0.03);
        const textY = Math.round(templateHeight * 0.9);
        logger.debug("Adding URL text to PDF", {
            requestId,
            fontSize,
            textY,
        });

        doc.font("Helvetica-Bold").fontSize(fontSize).text(url, 0, textY, {
            align: "center",
            width: templateWidth,
        });

        // Finalize PDF
        doc.end();
        logger.info("PDF generation completed successfully", { requestId });
    } catch (error) {
        logger.error("Error during PDF generation", {
            requestId,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
        });
        res.status(500).json({
            error: "Failed to process image",
            details: error.message,
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error("Global error handler caught error", {
        error: {
            name: err.name,
            message: err.message,
            stack: err.stack,
        },
    });
    res.status(500).json({
        error: "Something went wrong!",
        details: err.message,
    });
});

// Start the server
app.listen(port, () => {
    logger.info("Server started", {
        port,
        endpoint: `http://localhost:${port}`,
        pdfEndpoint: `http://localhost:${port}/generate-qr-pdf`,
    });
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", {
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
        },
    });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled promise rejection", {
        reason: reason,
        promise: promise,
    });
});
