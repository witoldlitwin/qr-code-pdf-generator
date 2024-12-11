# QR code PDF generator

A Node.js Express app that generates a QR code from supplied URL and puts it in a PDF document.

The PDF template is stored in the `assets` folder.

The QR code is generated using the `qrcode` library.

The PDF is generated using the `pdfkit` library.

Specify the port number and the API endpoint auth secret in the `.env` file.
