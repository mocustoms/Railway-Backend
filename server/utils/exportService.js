const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class ExportService {
  constructor() {
    this.workbook = new ExcelJS.Workbook();
  }

  // Excel Export for Chart of Accounts
  async exportAccountsToExcel(accounts, filters = {}) {
    const workbook = new ExcelJS.Workbook(); // Create new workbook for this export
    const worksheet = workbook.addWorksheet('Chart of Accounts');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Parent Account', key: 'parentName', width: 25 },
      { header: 'Created By', key: 'createdBy', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 15 },
      { header: 'Updated By', key: 'updatedBy', width: 20 },
      { header: 'Updated Date', key: 'updatedAt', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Flatten the tree structure for export
    const flattenedAccounts = this.flattenAccountTree(accounts);
    
    // Add data rows
    flattenedAccounts.forEach(account => {
      worksheet.addRow({
        code: account.code || '',
        name: account.name,
        type: account.type,
        status: account.status || 'N/A',
        description: account.description || '',
        parentName: account.parentName || '',
        createdBy: account.creator ? `${account.creator.first_name || ''} ${account.creator.last_name || ''}`.trim() || account.creator.username : 'N/A',
        createdAt: account.created_at ? new Date(account.created_at).toLocaleDateString() : 'N/A',
        updatedBy: account.updater ? `${account.updater.first_name || ''} ${account.updater.last_name || ''}`.trim() || account.updater.username : 'N/A',
        updatedAt: account.updated_at ? new Date(account.updated_at).toLocaleDateString() : 'N/A'
      });
    });

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // Excel Export for Account Types
  async exportAccountTypesToExcel(accountTypes, filters = {}) {
    const workbook = new ExcelJS.Workbook(); // Create new workbook for this export
    const worksheet = workbook.addWorksheet('Account Types');
    
    // Define columns
    worksheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Nature', key: 'nature', width: 15 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Status', key: 'isActive', width: 12 },
      { header: 'Created By', key: 'createdBy', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 15 },
      { header: 'Updated By', key: 'updatedBy', width: 20 },
      { header: 'Updated Date', key: 'updatedAt', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    accountTypes.forEach(accountType => {
      worksheet.addRow({
        name: accountType.name,
        code: accountType.code,
        category: accountType.category,
        nature: accountType.nature,
        description: accountType.description || '',
        isActive: accountType.is_active ? 'Active' : 'Inactive',
        createdBy: accountType.creator ? `${accountType.creator.first_name || ''} ${accountType.creator.last_name || ''}`.trim() || accountType.creator.username : 'N/A',
        createdAt: accountType.created_at ? new Date(accountType.created_at).toLocaleDateString() : 'N/A',
        updatedBy: accountType.updater ? `${accountType.updater.first_name || ''} ${accountType.updater.last_name || ''}`.trim() || accountType.updater.username : 'N/A',
        updatedAt: accountType.updated_at ? new Date(accountType.updated_at).toLocaleDateString() : 'N/A'
      });
    });

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Chart of Accounts
  async exportAccountsToPDF(accounts, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Chart of Accounts', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Flatten the tree structure for export
        const flattenedAccounts = this.flattenAccountTree(accounts);

        // Add table headers
        const headers = ['Code', 'Name', 'Type', 'Status', 'Description'];
        const columnWidths = [60, 150, 60, 60, 120];
        let yPosition = doc.y;

        // Draw header row
        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach((header, index) => {
          doc.text(header, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveDown();

        // Draw data rows
        doc.fontSize(9).font('Helvetica');
        flattenedAccounts.forEach((account, index) => {
          // Check if we need a new page
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }

          const rowData = [
            account.code || '',
            account.name,
            account.type,
            account.status || 'N/A',
            account.description || ''
          ];

          rowData.forEach((cell, cellIndex) => {
            const x = 50 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0);
            doc.text(cell, x, yPosition);
          });

          yPosition += 15;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // PDF Export for Account Types
  async exportAccountTypesToPDF(accountTypes, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Account Types', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add table headers
        const headers = ['Name', 'Code', 'Category', 'Nature', 'Description', 'Status'];
        const columnWidths = [100, 60, 60, 60, 120, 60];
        let yPosition = doc.y;

        // Draw header row
        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach((header, index) => {
          doc.text(header, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveDown();

        // Draw data rows
        doc.fontSize(9).font('Helvetica');
        accountTypes.forEach((accountType, index) => {
          // Check if we need a new page
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }

          const rowData = [
            accountType.name,
            accountType.code,
            accountType.category,
            accountType.nature,
            accountType.description || '',
            accountType.is_active ? 'Active' : 'Inactive'
          ];

          rowData.forEach((cell, cellIndex) => {
            const x = 50 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0);
            doc.text(cell, x, yPosition);
          });

          yPosition += 15;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Helper method to flatten account tree structure
  flattenAccountTree(accounts, level = 0, parentName = '') {
    let flattened = [];
    
    accounts.forEach(account => {
      const accountData = {
        ...account,
        level,
        parentName
      };
      
      flattened.push(accountData);
      
      if (account.children && account.children.length > 0) {
        const children = this.flattenAccountTree(account.children, level + 1, account.name);
        flattened = flattened.concat(children);
      }
    });
    
    return flattened;
  }

  // Excel Export for Opening Balances
  async exportOpeningBalancesToExcel(openingBalances, filters = {}) {
    const workbook = new ExcelJS.Workbook(); // Create new workbook for this export
    const worksheet = workbook.addWorksheet('Opening Balances');
    
    // Define columns
    worksheet.columns = [
      { header: 'Account Code', key: 'accountCode', width: 15 },
      { header: 'Account Name', key: 'accountName', width: 30 },
      { header: 'Account Type', key: 'accountType', width: 15 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Original Amount', key: 'originalAmount', width: 15 },
      { header: 'Equivalent (TZS)', key: 'equivalentAmount', width: 15 },
      { header: 'Currency', key: 'currency', width: 12 },
      { header: 'Exchange Rate', key: 'exchangeRate', width: 15 },
      { header: 'Financial Year', key: 'financialYear', width: 20 },
      { header: 'Reference Number', key: 'referenceNumber', width: 20 },
      { header: 'Created By', key: 'createdBy', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 15 },
      { header: 'Updated By', key: 'updatedBy', width: 20 },
      { header: 'Updated Date', key: 'updatedAt', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    openingBalances.forEach(openingBalance => {
      worksheet.addRow({
        accountCode: openingBalance.account?.code || '',
        accountName: openingBalance.account?.name || '',
        accountType: openingBalance.account?.type || '',
        type: openingBalance.type?.toUpperCase() || '',
        date: openingBalance.date ? new Date(openingBalance.date).toLocaleDateString() : '',
        description: openingBalance.description || '',
        amount: openingBalance.originalAmount || openingBalance.amount || 0,
        originalAmount: openingBalance.originalAmount || '',
        equivalentAmount: openingBalance.equivalentAmount || 0,
        currency: openingBalance.currency?.code || 'TZS',
        exchangeRate: openingBalance.exchangeRate || 1,
        financialYear: openingBalance.financialYear?.name || '',
        referenceNumber: openingBalance.referenceNumber || '',
        createdBy: openingBalance.creator ? `${openingBalance.creator.first_name || ''} ${openingBalance.creator.last_name || ''}`.trim() || openingBalance.creator.username : 'N/A',
        createdAt: openingBalance.created_at ? new Date(openingBalance.created_at).toLocaleDateString() : 'N/A',
        updatedBy: openingBalance.updater ? `${openingBalance.updater.first_name || ''} ${openingBalance.updater.last_name || ''}`.trim() || openingBalance.updater.username : 'N/A',
        updatedAt: openingBalance.updated_at ? new Date(openingBalance.updated_at).toLocaleDateString() : 'N/A'
      });
    });

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Opening Balances
  async exportOpeningBalancesToPDF(openingBalances, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Opening Balances', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add table headers
        const headers = ['Account', 'Type', 'Date', 'Amount', 'Currency', 'Ref #', 'Created By'];
        const columnWidths = [120, 40, 60, 80, 50, 80, 80];
        let yPosition = doc.y;

        // Draw header row
        doc.fontSize(8).font('Helvetica-Bold');
        headers.forEach((header, index) => {
          doc.text(header, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveDown();

        // Draw data rows
        doc.fontSize(7).font('Helvetica');
        openingBalances.forEach((openingBalance, index) => {
          // Check if we need a new page
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }

          const rowData = [
            `${openingBalance.account?.code || ''} - ${openingBalance.account?.name || ''}`,
            openingBalance.type?.toUpperCase() || '',
            openingBalance.date ? new Date(openingBalance.date).toLocaleDateString() : '',
            openingBalance.originalAmount || openingBalance.amount || 0,
            openingBalance.currency?.code || 'TZS',
            openingBalance.referenceNumber || '',
            openingBalance.creator ? `${openingBalance.creator.first_name || ''} ${openingBalance.creator.last_name || ''}`.trim() || openingBalance.creator.username : 'N/A'
          ];

          rowData.forEach((cell, cellIndex) => {
            const x = 50 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0);
            doc.text(cell, x, yPosition);
          });

          yPosition += 15;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Product Manufacturers
  async exportManufacturersToExcel(manufacturers, filters = {}) {
    const workbook = new ExcelJS.Workbook(); // Create new workbook for this export
    const worksheet = workbook.addWorksheet('Product Manufacturers');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Contact Email', key: 'contactEmail', width: 25 },
      { header: 'Contact Phone', key: 'contactPhone', width: 20 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'Country', key: 'country', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created By', key: 'createdBy', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 15 },
      { header: 'Updated By', key: 'updatedBy', width: 20 },
      { header: 'Updated Date', key: 'updatedAt', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    manufacturers.forEach(manufacturer => {
      worksheet.addRow({
        code: manufacturer.code || '',
        name: manufacturer.name || '',
        description: manufacturer.description || '',
        website: manufacturer.website || '',
        contactEmail: manufacturer.contact_email || '',
        contactPhone: manufacturer.contact_phone || '',
        address: manufacturer.address || '',
        country: manufacturer.country || '',
        status: manufacturer.is_active ? 'Active' : 'Inactive',
        createdBy: manufacturer.createdByUser 
          ? `${manufacturer.createdByUser.first_name || ''} ${manufacturer.createdByUser.last_name || ''}`.trim() || 'N/A'
          : 'N/A',
        createdAt: manufacturer.created_at ? new Date(manufacturer.created_at).toLocaleDateString() : 'N/A',
        updatedBy: manufacturer.updatedByUser 
          ? `${manufacturer.updatedByUser.first_name || ''} ${manufacturer.updatedByUser.last_name || ''}`.trim() || 'N/A'
          : 'N/A',
        updatedAt: manufacturer.updated_at ? new Date(manufacturer.updated_at).toLocaleDateString() : 'N/A'
      });
    });

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Product Manufacturers
  async exportManufacturersToPDF(manufacturers, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Product Manufacturers', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add table headers
        const headers = ['Code', 'Name', 'Description', 'Website', 'Contact', 'Country', 'Status'];
        const columnWidths = [60, 120, 100, 80, 80, 60, 50];
        let yPosition = doc.y;

        // Draw header row
        doc.fontSize(8).font('Helvetica-Bold');
        headers.forEach((header, index) => {
          doc.text(header, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveDown();

        // Draw data rows
        doc.fontSize(7).font('Helvetica');
        manufacturers.forEach((manufacturer, index) => {
          // Check if we need a new page
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }

          const rowData = [
            manufacturer.code || '',
            manufacturer.name || '',
            (manufacturer.description || '').substring(0, 30) + (manufacturer.description && manufacturer.description.length > 30 ? '...' : ''),
            (manufacturer.website || '').substring(0, 25) + (manufacturer.website && manufacturer.website.length > 25 ? '...' : ''),
            `${manufacturer.contact_email || ''} ${manufacturer.contact_phone || ''}`.trim() || 'N/A',
            manufacturer.country || '',
            manufacturer.is_active ? 'Active' : 'Inactive'
          ];

          rowData.forEach((cell, cellIndex) => {
            const x = 50 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0);
            doc.text(cell, x, yPosition);
          });

          yPosition += 15;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Packaging
  async exportPackagingToExcel(packaging, filters = {}) {
    const workbook = new ExcelJS.Workbook(); // Create new workbook for this export
    const worksheet = workbook.addWorksheet('Packaging');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Pieces', key: 'pieces', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created By', key: 'createdBy', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 15 },
      { header: 'Updated By', key: 'updatedBy', width: 20 },
      { header: 'Updated Date', key: 'updatedAt', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    
    // Add data rows
    packaging.forEach(pkg => {
      worksheet.addRow({
        code: pkg.code || '',
        name: pkg.name || '',
        pieces: pkg.pieces || 0,
        status: pkg.status === 'active' ? 'Active' : 'Inactive',
        createdBy: pkg.creator ? `${pkg.creator.first_name || ''} ${pkg.creator.last_name || ''}`.trim() || 'N/A' : 'N/A',
        createdAt: pkg.createdAt ? new Date(pkg.createdAt).toLocaleDateString() : 'N/A',
        updatedBy: pkg.updater ? `${pkg.updater.first_name || ''} ${pkg.updater.last_name || ''}`.trim() || 'N/A' : 'N/A',
        updatedAt: pkg.updatedAt ? new Date(pkg.updatedAt).toLocaleDateString() : 'N/A'
      });
    });

    // Return buffer
    return await workbook.xlsx.writeBuffer();
  }

  // PDF Export for Packaging
  async exportPackagingToPDF(packaging, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const buffers = [];
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const buffer = Buffer.concat(buffers);
          resolve(buffer);
        });

        // Title
        doc.font('Helvetica-Bold')
           .fontSize(20)
           .text('Packaging Report', { align: 'center' });
        
        doc.moveDown(1);

        // Add export timestamp
        doc.font('Helvetica')
           .fontSize(10)
           .text(`Generated on: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, { align: 'right' });

        // Add filters information if any
        if (filters.search || filters.status) {
          doc.moveDown(0.5);
          doc.text('Filters Applied:', { align: 'left' });
          if (filters.search) doc.text(`Search: ${filters.search}`);
          if (filters.status && filters.status !== 'all') doc.text(`Status: ${filters.status}`);
        }

        doc.moveDown(1);

        // Table headers
        const headers = ['Code', 'Name', 'Pieces', 'Status', 'Created By', 'Created Date'];
        const columnWidths = [80, 120, 60, 60, 100, 80];
        let yPosition = doc.y + 20;

        // Draw header row
        doc.font('Helvetica-Bold').fontSize(9);
        headers.forEach((header, index) => {
          const x = 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0);
          doc.text(header, x, yPosition);
        });

        // Draw header line
        yPosition += 15;
        doc.moveTo(50, yPosition)
           .lineTo(550, yPosition)
           .stroke();
        yPosition += 10;

        // Add data rows
        doc.font('Helvetica').fontSize(8);
        packaging.forEach(pkg => {
          // Check if we need a new page
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }

          const rowData = [
            pkg.code || '',
            pkg.name || '',
            pkg.pieces?.toString() || '0',
            pkg.status === 'active' ? 'Active' : 'Inactive',
            pkg.creator ? `${pkg.creator.first_name || ''} ${pkg.creator.last_name || ''}`.trim() || 'N/A' : 'N/A',
            pkg.createdAt ? new Date(pkg.createdAt).toLocaleDateString() : 'N/A'
          ];

          rowData.forEach((cell, cellIndex) => {
            const x = 50 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0);
            doc.text(cell, x, yPosition);
          });

          yPosition += 15;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Product Brand Names
  async exportBrandNamesToExcel(brandNames, filters = {}) {
    const workbook = new ExcelJS.Workbook(); // Create new workbook for this export
    const worksheet = workbook.addWorksheet('Product Brand Names');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created By', key: 'createdBy', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 15 },
      { header: 'Updated By', key: 'updatedBy', width: 20 },
      { header: 'Updated Date', key: 'updatedAt', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    brandNames.forEach(brandName => {
      worksheet.addRow({
        code: brandName.code || '',
        name: brandName.name || '',
        description: brandName.description || '',
        status: brandName.is_active ? 'Active' : 'Inactive',
        createdBy: brandName.created_by_name || 'N/A',
        createdAt: brandName.created_at ? new Date(brandName.created_at).toLocaleDateString() : 'N/A',
        updatedBy: brandName.updated_by_name || 'N/A',
        updatedAt: brandName.updated_at ? new Date(brandName.updated_at).toLocaleDateString() : 'N/A'
      });
    });

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Product Brand Names
  async exportBrandNamesToPDF(brandNames, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Product Brand Names', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add data
        doc.fontSize(12).font('Helvetica-Bold').text('Brand Names:', { underline: true });
        doc.moveDown();

        brandNames.forEach((brandName, index) => {
          doc.fontSize(10).font('Helvetica-Bold').text(`${index + 1}. ${brandName.name} (${brandName.code})`);
          doc.fontSize(9).font('Helvetica');
          
          if (brandName.description) {
            doc.text(`   Description: ${brandName.description}`);
          }
          
          doc.text(`   Status: ${brandName.is_active ? 'Active' : 'Inactive'}`);
          doc.text(`   Created: ${brandName.created_at ? new Date(brandName.created_at).toLocaleDateString() : 'N/A'}`);
          
          if (brandName.created_by_name) {
            doc.text(`   Created By: ${brandName.created_by_name}`);
          }
          
          doc.moveDown(0.5);
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Product Categories
  async exportCategoriesToExcel(categories, filters = {}) {
    const workbook = new ExcelJS.Workbook(); // Create new workbook for this export
    const worksheet = workbook.addWorksheet('Product Categories');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Category Name', key: 'name', width: 25 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Color', key: 'color', width: 15 },
      { header: 'Tax Code', key: 'tax_code_name', width: 20 },
      { header: 'Purchases Tax', key: 'purchases_tax_name', width: 20 },
      { header: 'COGS Account', key: 'cogs_account_name', width: 25 },
      { header: 'Income Account', key: 'income_account_name', width: 25 },
      { header: 'Asset Account', key: 'asset_account_name', width: 25 },
      { header: 'Status', key: 'is_active', width: 12 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 20 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 20 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    categories.forEach(category => {
      worksheet.addRow({
        code: category.code || '',
        name: category.name || '',
        description: category.description || '',
        color: category.color || '',
        tax_code_name: category.tax_code_name || '',
        purchases_tax_name: category.purchases_tax_name || '',
        cogs_account_name: category.cogs_account_name || '',
        income_account_name: category.income_account_name || '',
        asset_account_name: category.asset_account_name || '',
        is_active: category.is_active ? 'Active' : 'Inactive',
        created_by_name: category.created_by_name || 'System',
        created_at: category.created_at ? new Date(category.created_at).toLocaleDateString() : 'N/A',
        updated_by_name: category.updated_by_name || 'System',
        updated_at: category.updated_at ? new Date(category.updated_at).toLocaleDateString() : 'N/A'
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `N${categories.length + 1}`
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Product Categories
  async exportCategoriesToPDF(categories, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
          layout: 'landscape'  // Use landscape for more columns
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Product Categories Report', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add data
        doc.fontSize(12).font('Helvetica-Bold').text('Categories:', { underline: true });
        doc.moveDown();

        categories.forEach((category, index) => {
          doc.fontSize(10).font('Helvetica-Bold').text(`${index + 1}. ${category.name} (${category.code})`);
          doc.fontSize(9).font('Helvetica');
          
          if (category.description) {
            doc.text(`   Description: ${category.description}`);
          }
          
          if (category.color) {
            doc.text(`   Color: ${category.color}`);
          }
          
          if (category.tax_code_name) {
            doc.text(`   Tax Code: ${category.tax_code_name}`);
          }
          
          doc.text(`   Status: ${category.is_active ? 'Active' : 'Inactive'}`);
          doc.text(`   Created: ${category.created_at ? new Date(category.created_at).toLocaleDateString() : 'N/A'}`);
          
          if (category.created_by_name) {
            doc.text(`   Created By: ${category.created_by_name}`);
          }
          
          doc.moveDown(0.5);
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Products
  async exportProductsToExcel(products, filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Products');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Part Number', key: 'part_number', width: 20 },
      { header: 'Barcode', key: 'barcode', width: 20 },
      { header: 'Product Type', key: 'product_type', width: 15 },
      { header: 'Category', key: 'category_name', width: 20 },
      { header: 'Brand', key: 'brand_name', width: 20 },
      { header: 'Manufacturer', key: 'manufacturer_name', width: 20 },
      { header: 'Model', key: 'model_name', width: 20 },
      { header: 'Color', key: 'color_name', width: 15 },
      { header: 'Unit', key: 'unit_name', width: 15 },
      { header: 'Average Cost', key: 'average_cost', width: 15 },
      { header: 'Selling Price', key: 'selling_price', width: 15 },
      { header: 'Min Quantity', key: 'min_quantity', width: 15 },
      { header: 'Max Quantity', key: 'max_quantity', width: 15 },
      { header: 'Reorder Point', key: 'reorder_point', width: 15 },
      { header: 'Track Serial', key: 'track_serial_number', width: 15 },
      { header: 'Tax Inclusive', key: 'price_tax_inclusive', width: 15 },
      { header: 'Status', key: 'is_active', width: 12 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 15 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    products.forEach(product => {
      worksheet.addRow({
        code: product.code || '',
        name: product.name || '',
        part_number: product.part_number || '',
        barcode: product.barcode || '',
        product_type: product.product_type || '',
        category_name: product.category?.name || '',
        brand_name: product.brand?.name || '',
        manufacturer_name: product.manufacturer?.name || '',
        model_name: product.model?.name || '',
        color_name: product.color?.name || '',
        unit_name: product.unit?.name || '',
        average_cost: product.average_cost || 0,
        selling_price: product.selling_price || 0,
        min_quantity: product.min_quantity || 0,
        max_quantity: product.max_quantity || 0,
        reorder_point: product.reorder_point || 0,
        track_serial_number: product.track_serial_number ? 'Yes' : 'No',
        price_tax_inclusive: product.price_tax_inclusive ? 'Yes' : 'No',
        is_active: product.is_active ? 'Active' : 'Inactive',
        description: product.description || '',
        created_by_name: product.created_by_name || 'System',
        created_at: product.created_at ? new Date(product.created_at).toLocaleDateString() : 'N/A',
        updated_by_name: product.updated_by_name || 'System',
        updated_at: product.updated_at ? new Date(product.updated_at).toLocaleDateString() : 'N/A'
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `V${products.length + 1}`
    };

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Products
  async exportProductsToPDF(products, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
          layout: 'landscape'
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Products Report', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add summary
        doc.fontSize(12).font('Helvetica-Bold').text(`Total Products: ${products.length}`, { underline: true });
        doc.moveDown();

        // Add data in a table format
        let yPosition = doc.y;
        const startX = 50;
        const colWidths = [60, 120, 80, 80, 60, 80, 80, 80, 80, 60, 60, 80, 80, 60, 60, 60, 60, 60, 60, 80, 60, 60, 60, 60];
        const headers = ['Code', 'Name', 'Type', 'Category', 'Brand', 'Cost', 'Price', 'Min Qty', 'Max Qty', 'Reorder', 'Status'];

        // Draw headers
        headers.forEach((header, index) => {
          doc.fontSize(8).font('Helvetica-Bold').text(header, startX + colWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveTo(startX, yPosition).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), yPosition).stroke();
        yPosition += 10;

        // Add product rows (limited to fit on page)
        products.slice(0, 20).forEach((product, index) => {
          if (yPosition > 500) {
            doc.addPage();
            yPosition = 50;
          }

          doc.fontSize(7).font('Helvetica');
          let xPos = startX;
          
          doc.text(product.code || '', xPos, yPosition); xPos += colWidths[0];
          doc.text(product.name?.substring(0, 15) || '', xPos, yPosition); xPos += colWidths[1];
          doc.text(product.product_type || '', xPos, yPosition); xPos += colWidths[2];
          doc.text(product.category?.name?.substring(0, 10) || '', xPos, yPosition); xPos += colWidths[3];
          doc.text(product.brand?.name?.substring(0, 10) || '', xPos, yPosition); xPos += colWidths[4];
          doc.text(product.average_cost?.toString() || '0', xPos, yPosition); xPos += colWidths[5];
          doc.text(product.selling_price?.toString() || '0', xPos, yPosition); xPos += colWidths[6];
          doc.text(product.min_quantity?.toString() || '0', xPos, yPosition); xPos += colWidths[7];
          doc.text(product.max_quantity?.toString() || '0', xPos, yPosition); xPos += colWidths[8];
          doc.text(product.reorder_point?.toString() || '0', xPos, yPosition); xPos += colWidths[9];
          doc.text(product.is_active ? 'Active' : 'Inactive', xPos, yPosition);

          yPosition += 15;
        });

        // Add note if products were truncated
        if (products.length > 20) {
          doc.moveDown();
          doc.fontSize(10).font('Helvetica').text(`Note: Only first 20 products shown. Total products: ${products.length}`, { color: 'red' });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Stock Adjustments
  async exportStockAdjustmentsToExcel(stockAdjustments, filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Stock Adjustments');
    
    // Define columns
    worksheet.columns = [
      { header: 'Reference Number', key: 'reference_number', width: 20 },
      { header: 'Document Number', key: 'document_number', width: 20 },
      { header: 'Adjustment Date', key: 'adjustment_date', width: 15 },
      { header: 'Store', key: 'store_name', width: 20 },
      { header: 'Adjustment Type', key: 'adjustment_type', width: 15 },
      { header: 'Reason', key: 'adjustment_reason_name', width: 25 },
      { header: 'Total Items', key: 'total_items', width: 12 },
      { header: 'Total Value', key: 'total_value', width: 15 },
      { header: 'Currency', key: 'currency_symbol', width: 10 },
      { header: 'Exchange Rate', key: 'exchange_rate', width: 15 },
      { header: 'Equivalent Amount', key: 'equivalent_amount', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Notes', key: 'notes', width: 30 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 15 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 15 },
      { header: 'Submitted By', key: 'submitted_by_name', width: 20 },
      { header: 'Submitted Date', key: 'submitted_at', width: 15 },
      { header: 'Approved By', key: 'approved_by_name', width: 20 },
      { header: 'Approved Date', key: 'approved_at', width: 15 },
      { header: 'Rejection Reason', key: 'rejection_reason', width: 30 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    stockAdjustments.forEach(adjustment => {
      worksheet.addRow({
        reference_number: adjustment.reference_number || '',
        document_number: adjustment.document_number || '',
        adjustment_date: adjustment.adjustment_date ? new Date(adjustment.adjustment_date).toLocaleDateString() : '',
        store_name: adjustment.store_name || '',
        adjustment_type: adjustment.adjustment_type || '',
        adjustment_reason_name: adjustment.adjustment_reason_name || '',
        total_items: adjustment.total_items || 0,
        total_value: adjustment.total_value || 0,
        currency_symbol: adjustment.currency_symbol || '$',
        exchange_rate: adjustment.exchange_rate || 1,
        equivalent_amount: adjustment.equivalent_amount || 0,
        status: adjustment.status || '',
        notes: adjustment.notes || '',
        created_by_name: adjustment.created_by_name || 'System',
        created_at: adjustment.created_at ? new Date(adjustment.created_at).toLocaleDateString() : 'N/A',
        updated_by_name: adjustment.updated_by_name || '',
        updated_at: adjustment.updated_at ? new Date(adjustment.updated_at).toLocaleDateString() : '',
        submitted_by_name: adjustment.submitted_by_name || '',
        submitted_at: adjustment.submitted_at ? new Date(adjustment.submitted_at).toLocaleDateString() : '',
        approved_by_name: adjustment.approved_by_name || '',
        approved_at: adjustment.approved_at ? new Date(adjustment.approved_at).toLocaleDateString() : '',
        rejection_reason: adjustment.rejection_reason || ''
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `V${stockAdjustments.length + 1}`
    };

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Stock Adjustments
  async exportStockAdjustmentsToPDF(stockAdjustments, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
          layout: 'landscape'
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Stock Adjustments Report', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add summary
        doc.fontSize(12).font('Helvetica-Bold').text(`Total Adjustments: ${stockAdjustments.length}`, { underline: true });
        doc.moveDown();

        // Add data in a table format
        let yPosition = doc.y;
        const startX = 50;
        const colWidths = [80, 80, 60, 80, 60, 100, 50, 60, 40, 50, 60, 50, 100, 80, 60, 80, 60, 80, 60, 80, 60, 100];
        const headers = ['Ref #', 'Date', 'Store', 'Type', 'Reason', 'Items', 'Value', 'Currency', 'Status', 'Created By', 'Created Date'];

        // Draw headers
        headers.forEach((header, index) => {
          doc.fontSize(8).font('Helvetica-Bold').text(header, startX + colWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveTo(startX, yPosition).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), yPosition).stroke();
        yPosition += 10;

        // Add adjustment rows (limited to fit on page)
        stockAdjustments.slice(0, 25).forEach((adjustment, index) => {
          if (yPosition > 500) {
            doc.addPage();
            yPosition = 50;
          }

          doc.fontSize(7).font('Helvetica');
          let xPos = startX;
          
          doc.text(adjustment.reference_number || '', xPos, yPosition); xPos += colWidths[0];
          doc.text(adjustment.adjustment_date ? new Date(adjustment.adjustment_date).toLocaleDateString() : '', xPos, yPosition); xPos += colWidths[1];
          doc.text(adjustment.store_name?.substring(0, 10) || '', xPos, yPosition); xPos += colWidths[2];
          doc.text(adjustment.adjustment_type || '', xPos, yPosition); xPos += colWidths[3];
          doc.text(adjustment.adjustment_reason_name?.substring(0, 15) || '', xPos, yPosition); xPos += colWidths[4];
          doc.text(adjustment.total_items?.toString() || '0', xPos, yPosition); xPos += colWidths[5];
          doc.text(adjustment.total_value?.toString() || '0', xPos, yPosition); xPos += colWidths[6];
          doc.text(adjustment.currency_symbol || '$', xPos, yPosition); xPos += colWidths[7];
          doc.text(adjustment.status || '', xPos, yPosition); xPos += colWidths[8];
          doc.text(adjustment.created_by_name?.substring(0, 10) || 'System', xPos, yPosition); xPos += colWidths[9];
          doc.text(adjustment.created_at ? new Date(adjustment.created_at).toLocaleDateString() : 'N/A', xPos, yPosition);

          yPosition += 15;
        });

        // Add note if adjustments were truncated
        if (stockAdjustments.length > 25) {
          doc.moveDown();
          doc.fontSize(10).font('Helvetica').text(`Note: Only first 25 adjustments shown. Total adjustments: ${stockAdjustments.length}`, { color: 'red' });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Adjustment Reasons
  async exportAdjustmentReasonsToExcel(adjustmentReasons, filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Adjustment Reasons');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Adjustment Type', key: 'adjustment_type', width: 15 },
      { header: 'Status', key: 'is_active', width: 12 },
      { header: 'Tracking Account', key: 'tracking_account_name', width: 25 },
      { header: 'Corresponding Account', key: 'corresponding_account_name', width: 25 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 15 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    adjustmentReasons.forEach(reason => {
      worksheet.addRow({
        code: reason.code || '',
        name: reason.name,
        description: reason.description || '',
        adjustment_type: reason.adjustment_type || '',
        is_active: reason.is_active ? 'Active' : 'Inactive',
        tracking_account_name: reason.trackingAccount?.name || 'N/A',
        corresponding_account_name: reason.correspondingAccount?.name || 'N/A',
        created_by_name: reason.createdByUser ? `${reason.createdByUser.first_name || ''} ${reason.createdByUser.last_name || ''}`.trim() || reason.createdByUser.username : 'System',
        created_at: reason.created_at ? new Date(reason.created_at).toLocaleDateString() : 'N/A',
        updated_by_name: reason.updatedByUser ? `${reason.updatedByUser.first_name || ''} ${reason.updatedByUser.last_name || ''}`.trim() || reason.updatedByUser.username : '',
        updated_at: reason.updated_at ? new Date(reason.updated_at).toLocaleDateString() : ''
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `K${adjustmentReasons.length + 1}`
    };

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Adjustment Reasons
  async exportAdjustmentReasonsToPDF(adjustmentReasons, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
          layout: 'landscape'
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Adjustment Reasons Report', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add summary
        doc.fontSize(12).font('Helvetica-Bold').text(`Total Adjustment Reasons: ${adjustmentReasons.length}`, { underline: true });
        doc.moveDown();

        // Add data in a table format
        let yPosition = doc.y;
        const startX = 50;
        const colWidths = [60, 120, 150, 80, 60, 120, 120, 80, 60, 80, 60];
        const headers = ['Code', 'Name', 'Description', 'Type', 'Status', 'Tracking Account', 'Corresponding Account', 'Created By', 'Created Date', 'Updated By', 'Updated Date'];

        // Draw headers
        headers.forEach((header, index) => {
          doc.fontSize(8).font('Helvetica-Bold').text(header, startX + colWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveTo(startX, yPosition).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), yPosition).stroke();
        yPosition += 10;

        // Add reason rows (limited to fit on page)
        adjustmentReasons.slice(0, 20).forEach((reason, index) => {
          if (yPosition > 500) {
            doc.addPage();
            yPosition = 50;
          }

          doc.fontSize(7).font('Helvetica');
          let xPos = startX;
          
          doc.text(reason.code || '', xPos, yPosition); xPos += colWidths[0];
          doc.text(reason.name?.substring(0, 15) || '', xPos, yPosition); xPos += colWidths[1];
          doc.text(reason.description?.substring(0, 20) || '', xPos, yPosition); xPos += colWidths[2];
          doc.text(reason.adjustment_type || '', xPos, yPosition); xPos += colWidths[3];
          doc.text(reason.is_active ? 'Active' : 'Inactive', xPos, yPosition); xPos += colWidths[4];
          doc.text(reason.trackingAccount?.name?.substring(0, 15) || 'N/A', xPos, yPosition); xPos += colWidths[5];
          doc.text(reason.correspondingAccount?.name?.substring(0, 15) || 'N/A', xPos, yPosition); xPos += colWidths[6];
          doc.text(reason.createdByUser ? `${reason.createdByUser.first_name || ''} ${reason.createdByUser.last_name || ''}`.trim().substring(0, 10) || reason.createdByUser.username : 'System', xPos, yPosition); xPos += colWidths[7];
          doc.text(reason.created_at ? new Date(reason.created_at).toLocaleDateString() : 'N/A', xPos, yPosition); xPos += colWidths[8];
          doc.text(reason.updatedByUser ? `${reason.updatedByUser.first_name || ''} ${reason.updatedByUser.last_name || ''}`.trim().substring(0, 10) || reason.updatedByUser.username : '', xPos, yPosition); xPos += colWidths[9];
          doc.text(reason.updated_at ? new Date(reason.updated_at).toLocaleDateString() : '', xPos, yPosition);

          yPosition += 15;
        });

        // Add note if reasons were truncated
        if (adjustmentReasons.length > 20) {
          doc.moveDown();
          doc.fontSize(10).font('Helvetica').text(`Note: Only first 20 adjustment reasons shown. Total reasons: ${adjustmentReasons.length}`, { color: 'red' });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Physical Inventories
  async exportPhysicalInventoriesToExcel(physicalInventories, filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Physical Inventories');
    
    // Define columns
    worksheet.columns = [
      { header: 'Reference Number', key: 'reference_number', width: 20 },
      { header: 'Inventory Date', key: 'inventory_date', width: 15 },
      { header: 'Store', key: 'store_name', width: 25 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Total Items', key: 'total_items', width: 12 },
      { header: 'Total Value', key: 'total_value', width: 15 },
      { header: 'Currency', key: 'currency_name', width: 12 },
      { header: 'Exchange Rate', key: 'exchange_rate', width: 12 },
      { header: 'Equivalent Amount', key: 'equivalent_amount', width: 15 },
      { header: 'Notes', key: 'notes', width: 30 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 15 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 15 },
      { header: 'Submitted By', key: 'submitted_by_name', width: 20 },
      { header: 'Submitted Date', key: 'submitted_at', width: 15 },
      { header: 'Approved By', key: 'approved_by_name', width: 20 },
      { header: 'Approved Date', key: 'approved_at', width: 15 },
      { header: 'Rejection Reason', key: 'rejection_reason', width: 30 },
      { header: 'Return Reason', key: 'return_reason', width: 30 },
      { header: 'Total Delta Value', key: 'total_delta_value', width: 15 },
      { header: 'Positive Delta Value', key: 'positive_delta_value', width: 15 },
      { header: 'Negative Delta Value', key: 'negative_delta_value', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    physicalInventories.forEach(inventory => {
      worksheet.addRow({
        reference_number: inventory.reference_number || '',
        inventory_date: inventory.inventory_date ? new Date(inventory.inventory_date).toLocaleDateString() : '',
        store_name: inventory.store?.name || 'Unknown Store',
        status: inventory.status || '',
        total_items: inventory.total_items || 0,
        total_value: inventory.total_value || 0,
        currency_name: inventory.currency?.name || 'Unknown Currency',
        exchange_rate: inventory.exchange_rate || 1,
        equivalent_amount: inventory.equivalent_amount || 0,
        notes: inventory.notes || '',
        created_by_name: inventory.creator ? `${inventory.creator.first_name || ''} ${inventory.creator.last_name || ''}`.trim() || inventory.creator.username : 'System',
        created_at: inventory.created_at ? new Date(inventory.created_at).toLocaleDateString() : 'N/A',
        updated_by_name: inventory.updater ? `${inventory.updater.first_name || ''} ${inventory.updater.last_name || ''}`.trim() || inventory.updater.username : '',
        updated_at: inventory.updated_at ? new Date(inventory.updated_at).toLocaleDateString() : '',
        submitted_by_name: inventory.submitter ? `${inventory.submitter.first_name || ''} ${inventory.submitter.last_name || ''}`.trim() || inventory.submitter.username : '',
        submitted_at: inventory.submitted_at ? new Date(inventory.submitted_at).toLocaleDateString() : '',
        approved_by_name: inventory.approver ? `${inventory.approver.first_name || ''} ${inventory.approver.last_name || ''}`.trim() || inventory.approver.username : '',
        approved_at: inventory.approved_at ? new Date(inventory.approved_at).toLocaleDateString() : '',
        rejection_reason: inventory.rejection_reason || '',
        return_reason: inventory.return_reason || '',
        total_delta_value: inventory.total_delta_value || 0,
        positive_delta_value: inventory.positive_delta_value || 0,
        negative_delta_value: inventory.negative_delta_value || 0
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `W${physicalInventories.length + 1}`
    };

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Physical Inventories
  async exportPhysicalInventoriesToPDF(physicalInventories, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
          layout: 'landscape'
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Physical Inventories Report', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add summary
        doc.fontSize(12).font('Helvetica-Bold').text(`Total Physical Inventories: ${physicalInventories.length}`, { underline: true });
        doc.moveDown();

        // Add data in a table format
        let yPosition = doc.y;
        const startX = 50;
        const colWidths = [80, 60, 100, 60, 50, 60, 50, 50, 60, 100, 60, 60, 60, 60, 60, 60, 60, 60, 100, 100, 60, 60, 60];
        const headers = ['Ref #', 'Date', 'Store', 'Status', 'Items', 'Value', 'Currency', 'Rate', 'Equiv', 'Notes', 'Created By', 'Created', 'Updated By', 'Updated', 'Submitted By', 'Submitted', 'Approved By', 'Approved', 'Rejection', 'Return', 'Total Δ', 'Pos Δ', 'Neg Δ'];

        // Draw headers
        headers.forEach((header, index) => {
          doc.fontSize(8).font('Helvetica-Bold').text(header, startX + colWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveTo(startX, yPosition).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), yPosition).stroke();
        yPosition += 10;

        // Add inventory rows (limited to fit on page)
        physicalInventories.slice(0, 15).forEach((inventory, index) => {
          if (yPosition > 500) {
            doc.addPage();
            yPosition = 50;
          }

          doc.fontSize(7).font('Helvetica');
          let xPos = startX;
          
          doc.text(inventory.reference_number || '', xPos, yPosition); xPos += colWidths[0];
          doc.text(inventory.inventory_date ? new Date(inventory.inventory_date).toLocaleDateString() : '', xPos, yPosition); xPos += colWidths[1];
          doc.text(inventory.store?.name?.substring(0, 12) || 'Unknown', xPos, yPosition); xPos += colWidths[2];
          doc.text(inventory.status || '', xPos, yPosition); xPos += colWidths[3];
          doc.text(inventory.total_items?.toString() || '0', xPos, yPosition); xPos += colWidths[4];
          doc.text(inventory.total_value?.toString() || '0', xPos, yPosition); xPos += colWidths[5];
          doc.text(inventory.currency?.name?.substring(0, 6) || 'USD', xPos, yPosition); xPos += colWidths[6];
          doc.text(inventory.exchange_rate?.toString() || '1', xPos, yPosition); xPos += colWidths[7];
          doc.text(inventory.equivalent_amount?.toString() || '0', xPos, yPosition); xPos += colWidths[8];
          doc.text(inventory.notes?.substring(0, 12) || '', xPos, yPosition); xPos += colWidths[9];
          doc.text(inventory.creator ? `${inventory.creator.first_name || ''} ${inventory.creator.last_name || ''}`.trim().substring(0, 8) || inventory.creator.username : 'System', xPos, yPosition); xPos += colWidths[10];
          doc.text(inventory.created_at ? new Date(inventory.created_at).toLocaleDateString() : 'N/A', xPos, yPosition); xPos += colWidths[11];
          doc.text(inventory.updater ? `${inventory.updater.first_name || ''} ${inventory.updater.last_name || ''}`.trim().substring(0, 8) || inventory.updater.username : '', xPos, yPosition); xPos += colWidths[12];
          doc.text(inventory.updated_at ? new Date(inventory.updated_at).toLocaleDateString() : '', xPos, yPosition); xPos += colWidths[13];
          doc.text(inventory.submitter ? `${inventory.submitter.first_name || ''} ${inventory.submitter.last_name || ''}`.trim().substring(0, 8) || inventory.submitter.username : '', xPos, yPosition); xPos += colWidths[14];
          doc.text(inventory.submitted_at ? new Date(inventory.submitted_at).toLocaleDateString() : '', xPos, yPosition); xPos += colWidths[15];
          doc.text(inventory.approver ? `${inventory.approver.first_name || ''} ${inventory.approver.last_name || ''}`.trim().substring(0, 8) || inventory.approver.username : '', xPos, yPosition); xPos += colWidths[16];
          doc.text(inventory.approved_at ? new Date(inventory.approved_at).toLocaleDateString() : '', xPos, yPosition); xPos += colWidths[17];
          doc.text(inventory.rejection_reason?.substring(0, 12) || '', xPos, yPosition); xPos += colWidths[18];
          doc.text(inventory.return_reason?.substring(0, 12) || '', xPos, yPosition); xPos += colWidths[19];
          doc.text(inventory.total_delta_value?.toString() || '0', xPos, yPosition); xPos += colWidths[20];
          doc.text(inventory.positive_delta_value?.toString() || '0', xPos, yPosition); xPos += colWidths[21];
          doc.text(inventory.negative_delta_value?.toString() || '0', xPos, yPosition);

          yPosition += 15;
        });

        // Add note if inventories were truncated
        if (physicalInventories.length > 15) {
          doc.moveDown();
          doc.fontSize(10).font('Helvetica').text(`Note: Only first 15 physical inventories shown. Total inventories: ${physicalInventories.length}`, { color: 'red' });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Template for Physical Inventory Items Import
  async exportPhysicalInventoryItemsTemplate(templateData = []) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Physical Inventory Items');
    
    // Define columns - essential columns including batch, expiry, and serial tracking
    worksheet.columns = [
      { header: 'Product Code', key: 'product_code', width: 20 },
      { header: 'Counted Quantity', key: 'counted_quantity', width: 18 },
      { header: 'Unit Average Cost', key: 'unit_average_cost', width: 20 },
      { header: 'Batch Number', key: 'batch_number', width: 20 },
      { header: 'Expiry Date', key: 'expiry_date', width: 15 },
      { header: 'Serial Numbers', key: 'serial_numbers', width: 30 },
      { header: 'Notes', key: 'notes', width: 30 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add sample data - including batch, expiry, and serial tracking
    templateData.forEach(item => {
      worksheet.addRow({
        product_code: item.product_code,
        counted_quantity: item.counted_quantity,
        unit_average_cost: item.unit_average_cost,
        batch_number: item.batch_number || '',
        expiry_date: item.expiry_date || '',
        serial_numbers: item.serial_numbers || '',
        notes: item.notes
      });
    });

    // Add instructions sheet
    const instructionsSheet = workbook.addWorksheet('Instructions');
    instructionsSheet.columns = [
      { header: 'Column', key: 'column', width: 20 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Required', key: 'required', width: 10 },
      { header: 'Example', key: 'example', width: 20 }
    ];

    const instructions = [
      { column: 'Product Code', description: 'The unique code of the product (must exist in system)', required: 'Yes', example: '0000199' },
      { column: 'Counted Quantity', description: 'Actual counted quantity during inventory', required: 'Yes', example: '95' },
      { column: 'Unit Average Cost', description: 'Average cost per unit', required: 'Yes', example: '25.50' },
      { column: 'Batch Number', description: 'Batch or lot number for the product (optional)', required: 'No', example: 'BATCH001' },
      { column: 'Expiry Date', description: 'Expiry date in YYYY-MM-DD format (optional)', required: 'No', example: '2025-12-31' },
      { column: 'Serial Numbers', description: 'Comma-separated serial numbers (optional)', required: 'No', example: 'SN001,SN002,SN003' },
      { column: 'Notes', description: 'Additional notes for this item', required: 'No', example: 'Damaged items' }
    ];

    instructions.forEach(instruction => {
      instructionsSheet.addRow(instruction);
    });

    // Style instructions header
    instructionsSheet.getRow(1).font = { bold: true };
    instructionsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // Excel Export for Store Requests
  async exportStoreRequestsToExcel(storeRequests, filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Store Requests');
    
    // Define columns
    worksheet.columns = [
      { header: 'Reference Number', key: 'reference_number', width: 20 },
      { header: 'Request Date', key: 'request_date', width: 15 },
      { header: 'Requested By Store', key: 'requesting_store_name', width: 25 },
      { header: 'Requested From Store', key: 'issuing_store_name', width: 25 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Type', key: 'request_type', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Total Items', key: 'total_items', width: 12 },
      { header: 'Total Value', key: 'total_value', width: 15 },
      { header: 'Currency', key: 'currency_symbol', width: 12 },
      { header: 'Exchange Rate', key: 'exchange_rate', width: 15 },
      { header: 'Expected Delivery', key: 'expected_delivery_date', width: 18 },
      { header: 'Notes', key: 'notes', width: 30 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 15 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    storeRequests.forEach(request => {
      worksheet.addRow({
        reference_number: request.reference_number || '',
        request_date: request.request_date ? new Date(request.request_date).toLocaleDateString() : '',
        requesting_store_name: request.requestingStore?.name || '',
        issuing_store_name: request.issuingStore?.name || '',
        priority: request.priority || '',
        request_type: request.request_type || '',
        status: request.status || '',
        total_items: request.total_items || 0,
        total_value: request.total_value || 0,
        currency_symbol: request.storeRequestCurrency?.symbol || '',
        exchange_rate: request.exchange_rate || 1,
        expected_delivery_date: request.expected_delivery_date ? new Date(request.expected_delivery_date).toLocaleDateString() : '',
        notes: request.notes || '',
        created_by_name: request.createdByUser ? `${request.createdByUser.first_name || ''} ${request.createdByUser.last_name || ''}`.trim() : '',
        created_at: request.createdAt ? new Date(request.createdAt).toLocaleDateString() : '',
        updated_by_name: request.updatedByUser ? `${request.updatedByUser.first_name || ''} ${request.updatedByUser.last_name || ''}`.trim() : '',
        updated_at: request.updatedAt ? new Date(request.updatedAt).toLocaleDateString() : ''
      });
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      column.width = Math.max(column.width || 10, 12);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Store Requests
  async exportStoreRequestsToPDF(storeRequests, filters = {}) {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    
    return new Promise((resolve, reject) => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      
      doc.on('error', reject);

      // Add title
      doc.fontSize(20).text('Store Requests Export', { align: 'center' });
      doc.moveDown(2);

      // Add export info
      doc.fontSize(12);
      doc.text(`Export Date: ${new Date().toLocaleDateString()}`);
      doc.text(`Total Records: ${storeRequests.length}`);
      if (filters.request_type) {
        doc.text(`Type Filter: ${filters.request_type}`);
      }
      doc.moveDown(2);

      // Add table headers
      const tableTop = doc.y;
      const itemHeight = 20;
      const colWidths = [80, 60, 80, 80, 50, 50, 50, 50, 60, 50, 60, 80, 100];
      const headers = ['Ref #', 'Date', 'From', 'To', 'Priority', 'Type', 'Status', 'Items', 'Value', 'Currency', 'Rate', 'Delivery', 'Notes'];
      
      let x = 50;
      headers.forEach((header, i) => {
        doc.rect(x, tableTop, colWidths[i], itemHeight).stroke();
        doc.text(header, x + 5, tableTop + 5, { width: colWidths[i] - 10, align: 'left' });
        x += colWidths[i];
      });

      // Add data rows
      let y = tableTop + itemHeight;
      storeRequests.forEach((request, index) => {
        if (y > 700) { // Start new page if needed
          doc.addPage();
          y = 50;
        }

        const rowData = [
          request.reference_number || '',
          request.request_date ? new Date(request.request_date).toLocaleDateString() : '',
          request.requestingStore?.name || '',
          request.issuingStore?.name || '',
          request.priority || '',
          request.request_type || '',
          request.status || '',
          request.total_items || 0,
          request.total_value || 0,
          request.storeRequestCurrency?.symbol || '',
          request.exchange_rate || 1,
          request.expected_delivery_date ? new Date(request.expected_delivery_date).toLocaleDateString() : '',
          request.notes || ''
        ];

        x = 50;
        rowData.forEach((data, i) => {
          doc.rect(x, y, colWidths[i], itemHeight).stroke();
          doc.text(String(data), x + 5, y + 5, { width: colWidths[i] - 10, align: 'left' });
          x += colWidths[i];
        });

        y += itemHeight;
      });

      doc.end();
    });
  }

  // Generate PDF for Sales Agents
  async generateSalesAgentsPDF(salesAgents) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Add header
      doc.fontSize(20).text('Sales Agents Report', { align: 'center' });
      doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(2);

      // Add summary
      const totalAgents = salesAgents.length;
      const activeAgents = salesAgents.filter(agent => agent.status === 'active').length;
      const inactiveAgents = salesAgents.filter(agent => agent.status === 'inactive').length;

      doc.fontSize(14).text('Summary', { underline: true });
      doc.fontSize(12).text(`Total Agents: ${totalAgents}`);
      doc.text(`Active Agents: ${activeAgents}`);
      doc.text(`Inactive Agents: ${inactiveAgents}`);
      doc.moveDown(2);

      // Add table headers
      const tableTop = doc.y;
      const itemHeight = 20;
      const colWidths = [80, 120, 60, 100, 80, 80];
      const headers = ['Agent #', 'Full Name', 'Status', 'Created By', 'Created Date', 'Updated Date'];
      
      let x = 50;
      headers.forEach((header, i) => {
        doc.rect(x, tableTop, colWidths[i], itemHeight).stroke();
        doc.text(header, x + 5, tableTop + 5, { width: colWidths[i] - 10, align: 'left' });
        x += colWidths[i];
      });

      // Add data rows
      let y = tableTop + itemHeight;
      salesAgents.forEach((agent, index) => {
        if (y > 700) { // Start new page if needed
          doc.addPage();
          y = 50;
        }

        const rowData = [
          agent.agent_number || '',
          agent.full_name || '',
          agent.status || '',
          agent.createdByUser ? `${agent.createdByUser.first_name || ''} ${agent.createdByUser.last_name || ''}`.trim() : '',
          agent.created_at ? new Date(agent.created_at).toLocaleDateString() : '',
          agent.updated_at ? new Date(agent.updated_at).toLocaleDateString() : ''
        ];

        x = 50;
        rowData.forEach((data, i) => {
          doc.rect(x, y, colWidths[i], itemHeight).stroke();
          doc.text(String(data), x + 5, y + 5, { width: colWidths[i] - 10, align: 'left' });
          x += colWidths[i];
        });

        y += itemHeight;
      });

      doc.end();
    });
  }

  // Excel Export for Return Reasons
  async exportReturnReasonsToExcel(returnReasons, filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Return Reasons');
    
    // Define columns
    worksheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Return Type', key: 'return_type', width: 15 },
      { header: 'Requires Approval', key: 'requires_approval', width: 18 },
      { header: 'Max Return Days', key: 'max_return_days', width: 15 },
      { header: 'Status', key: 'is_active', width: 12 },
      { header: 'Refund Account', key: 'refund_account_name', width: 25 },
      { header: 'Inventory Account', key: 'inventory_account_name', width: 25 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 15 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    returnReasons.forEach(reason => {
      worksheet.addRow({
        code: reason.code || '',
        name: reason.name,
        description: reason.description || '',
        return_type: reason.return_type || '',
        requires_approval: reason.requires_approval ? 'Yes' : 'No',
        max_return_days: reason.max_return_days ? `${reason.max_return_days} days` : 'No limit',
        is_active: reason.is_active ? 'Active' : 'Inactive',
        refund_account_name: reason.refundAccount?.name || 'N/A',
        inventory_account_name: reason.inventoryAccount?.name || 'N/A',
        created_by_name: reason.createdByUserReturnReason ? `${reason.createdByUserReturnReason.first_name || ''} ${reason.createdByUserReturnReason.last_name || ''}`.trim() || reason.createdByUserReturnReason.username : 'System',
        created_at: reason.created_at ? new Date(reason.created_at).toLocaleDateString() : 'N/A',
        updated_by_name: reason.updatedByUserReturnReason ? `${reason.updatedByUserReturnReason.first_name || ''} ${reason.updatedByUserReturnReason.last_name || ''}`.trim() || reason.updatedByUserReturnReason.username : '',
        updated_at: reason.updated_at ? new Date(reason.updated_at).toLocaleDateString() : ''
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `M${returnReasons.length + 1}`
    };

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Return Reasons
  async exportReturnReasonsToPDF(returnReasons, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
          layout: 'landscape'
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Return Reasons Report', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add summary
        doc.fontSize(12).font('Helvetica-Bold').text(`Total Return Reasons: ${returnReasons.length}`, { underline: true });
        doc.moveDown();

        // Add data in a table format
        let yPosition = doc.y;
        const startX = 50;
        const colWidths = [50, 100, 120, 70, 60, 60, 50, 100, 100, 70, 50, 70, 50];
        const headers = ['Code', 'Name', 'Description', 'Type', 'Approval', 'Max Days', 'Status', 'Refund Account', 'Inventory Account', 'Created By', 'Created Date', 'Updated By', 'Updated Date'];

        // Draw headers
        headers.forEach((header, index) => {
          doc.fontSize(8).font('Helvetica-Bold').text(header, startX + colWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveTo(startX, yPosition).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), yPosition).stroke();
        yPosition += 10;

        // Add reason rows (limited to fit on page)
        returnReasons.slice(0, 20).forEach((reason, index) => {
          if (yPosition > 500) {
            doc.addPage();
            yPosition = 50;
          }

          doc.fontSize(7).font('Helvetica');
          let xPos = startX;
          
          doc.text(reason.code || '', xPos, yPosition); xPos += colWidths[0];
          doc.text(reason.name?.substring(0, 12) || '', xPos, yPosition); xPos += colWidths[1];
          doc.text(reason.description?.substring(0, 15) || '', xPos, yPosition); xPos += colWidths[2];
          doc.text(reason.return_type || '', xPos, yPosition); xPos += colWidths[3];
          doc.text(reason.requires_approval ? 'Yes' : 'No', xPos, yPosition); xPos += colWidths[4];
          doc.text(reason.max_return_days ? `${reason.max_return_days}d` : 'No limit', xPos, yPosition); xPos += colWidths[5];
          doc.text(reason.is_active ? 'Active' : 'Inactive', xPos, yPosition); xPos += colWidths[6];
          doc.text(reason.refundAccount?.name?.substring(0, 12) || 'N/A', xPos, yPosition); xPos += colWidths[7];
          doc.text(reason.inventoryAccount?.name?.substring(0, 12) || 'N/A', xPos, yPosition); xPos += colWidths[8];
          doc.text(reason.createdByUserReturnReason ? `${reason.createdByUserReturnReason.first_name || ''} ${reason.createdByUserReturnReason.last_name || ''}`.trim().substring(0, 8) || 'System' : 'System', xPos, yPosition); xPos += colWidths[9];
          doc.text(reason.created_at ? new Date(reason.created_at).toLocaleDateString() : 'N/A', xPos, yPosition); xPos += colWidths[10];
          doc.text(reason.updatedByUserReturnReason ? `${reason.updatedByUserReturnReason.first_name || ''} ${reason.updatedByUserReturnReason.last_name || ''}`.trim().substring(0, 8) || '' : '', xPos, yPosition); xPos += colWidths[11];
          doc.text(reason.updated_at ? new Date(reason.updated_at).toLocaleDateString() : '', xPos, yPosition);

          yPosition += 15;
        });

        // Add footer
        doc.fontSize(8).font('Helvetica').text(`Generated by EasyMauzo - Page ${doc.bufferedPageRange().count}`, 50, doc.page.height - 50);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Export for Proforma Invoices
  async exportProformaInvoicesToExcel(proformaInvoices, filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Proforma Invoices');
    
    // Define columns
    worksheet.columns = [
      { header: 'Ref Number', key: 'proforma_ref_number', width: 20 },
      { header: 'Date', key: 'proforma_date', width: 12 },
      { header: 'Customer Code', key: 'customer_code', width: 15 },
      { header: 'Customer Name', key: 'customer_name', width: 25 },
      { header: 'Store', key: 'store_name', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Currency', key: 'currency_name', width: 15 },
      { header: 'Currency Symbol', key: 'currency_symbol', width: 12 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'Tax Amount', key: 'tax_amount', width: 15 },
      { header: 'Discount Amount', key: 'discount_amount', width: 15 },
      { header: 'Total Amount', key: 'total_amount', width: 15 },
      { header: 'Valid Until', key: 'valid_until', width: 12 },
      { header: 'Created By', key: 'created_by_name', width: 20 },
      { header: 'Created Date', key: 'created_at', width: 18 },
      { header: 'Updated By', key: 'updated_by_name', width: 20 },
      { header: 'Updated Date', key: 'updated_at', width: 18 },
      { header: 'Sent By', key: 'sent_by_name', width: 20 },
      { header: 'Sent Date', key: 'sent_at', width: 18 },
      { header: 'Accepted By', key: 'accepted_by_name', width: 20 },
      { header: 'Accepted Date', key: 'accepted_at', width: 18 },
      { header: 'Rejected By', key: 'rejected_by_name', width: 20 },
      { header: 'Rejected Date', key: 'rejected_at', width: 18 },
      { header: 'Rejection Reason', key: 'rejection_reason', width: 30 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    proformaInvoices.forEach(invoice => {
      worksheet.addRow({
        proforma_ref_number: invoice.proforma_ref_number || '',
        proforma_date: invoice.proforma_date ? new Date(invoice.proforma_date).toLocaleDateString() : 'N/A',
        customer_code: invoice.customer?.customer_id || 'N/A',
        customer_name: invoice.customer?.full_name || 'N/A',
        store_name: invoice.store?.name || 'N/A',
        status: invoice.status || '',
        currency_name: invoice.currency?.name || 'N/A',
        currency_symbol: invoice.currency?.symbol || 'N/A',
        subtotal: invoice.subtotal ? parseFloat(invoice.subtotal).toFixed(2) : '0.00',
        tax_amount: invoice.tax_amount ? parseFloat(invoice.tax_amount).toFixed(2) : '0.00',
        discount_amount: invoice.discount_amount ? parseFloat(invoice.discount_amount).toFixed(2) : '0.00',
        total_amount: invoice.total_amount ? parseFloat(invoice.total_amount).toFixed(2) : '0.00',
        valid_until: invoice.valid_until ? new Date(invoice.valid_until).toLocaleDateString() : 'No limit',
        created_by_name: invoice.createdByUser ? `${invoice.createdByUser.first_name || ''} ${invoice.createdByUser.last_name || ''}`.trim() || invoice.createdByUser.username : 'System',
        created_at: invoice.created_at ? new Date(invoice.created_at).toLocaleString() : 'N/A',
        updated_by_name: invoice.updatedByUser ? `${invoice.updatedByUser.first_name || ''} ${invoice.updatedByUser.last_name || ''}`.trim() || invoice.updatedByUser.username : '-',
        updated_at: invoice.updated_at ? new Date(invoice.updated_at).toLocaleString() : '-',
        sent_by_name: invoice.sentByUser ? `${invoice.sentByUser.first_name || ''} ${invoice.sentByUser.last_name || ''}`.trim() || invoice.sentByUser.username : '-',
        sent_at: invoice.sent_at ? new Date(invoice.sent_at).toLocaleString() : '-',
        accepted_by_name: invoice.acceptedByUser ? `${invoice.acceptedByUser.first_name || ''} ${invoice.acceptedByUser.last_name || ''}`.trim() || invoice.acceptedByUser.username : '-',
        accepted_at: invoice.accepted_at ? new Date(invoice.accepted_at).toLocaleString() : '-',
        rejected_by_name: invoice.rejectedByUser ? `${invoice.rejectedByUser.first_name || ''} ${invoice.rejectedByUser.last_name || ''}`.trim() || invoice.rejectedByUser.username : '-',
        rejected_at: invoice.rejected_at ? new Date(invoice.rejected_at).toLocaleString() : '-',
        rejection_reason: invoice.rejection_reason || '-'
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `X${proformaInvoices.length + 1}`
    };

    // Add filters info if any
    if (Object.keys(filters).length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Filters Applied:']);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          worksheet.addRow([`${key}: ${value}`]);
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  // PDF Export for Proforma Invoices
  async exportProformaInvoicesToPDF(proformaInvoices, filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
          layout: 'landscape'
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Add title
        doc.fontSize(20).font('Helvetica-Bold').text('Proforma Invoices Report', { align: 'center' });
        doc.moveDown();

        // Add export date
        doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Add filters if any
        if (Object.keys(filters).length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied:');
          Object.entries(filters).forEach(([key, value]) => {
            if (value) {
              doc.fontSize(10).font('Helvetica').text(`${key}: ${value}`);
            }
          });
          doc.moveDown();
        }

        // Add summary
        doc.fontSize(12).font('Helvetica-Bold').text(`Total Proforma Invoices: ${proformaInvoices.length}`, { underline: true });
        doc.moveDown();

        // Add data in a table format
        let yPosition = doc.y;
        const startX = 50;
        // Adjusted column widths for better fit - using smaller widths for landscape
        const colWidths = [50, 45, 50, 60, 35, 40, 45, 40, 45, 50, 45, 50, 50, 50, 50, 50, 50, 50, 50];
        const headers = ['Ref #', 'Date', 'Customer', 'Store', 'Status', 'Currency', 'Subtotal', 'Tax', 'Discount', 'Total', 'Valid Until', 'Created By', 'Created', 'Sent By', 'Sent', 'Accepted By', 'Accepted', 'Rejected By', 'Rejected'];

        // Draw headers
        headers.forEach((header, index) => {
          doc.fontSize(7).font('Helvetica-Bold').text(header, startX + colWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition);
        });

        yPosition += 20;
        doc.moveTo(startX, yPosition).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), yPosition).stroke();
        yPosition += 10;

        // Add invoice rows (limited to fit on page)
        proformaInvoices.slice(0, 30).forEach((invoice, index) => {
          if (yPosition > 500) {
            doc.addPage();
            yPosition = 50;
          }

          doc.fontSize(6).font('Helvetica');
          let xPos = startX;
          
          doc.text(invoice.proforma_ref_number?.substring(0, 10) || '', xPos, yPosition); xPos += colWidths[0];
          doc.text(invoice.proforma_date ? new Date(invoice.proforma_date).toLocaleDateString() : 'N/A', xPos, yPosition); xPos += colWidths[1];
          doc.text((invoice.customer?.full_name || invoice.customer?.name || 'N/A')?.substring(0, 12) || 'N/A', xPos, yPosition); xPos += colWidths[2];
          doc.text(invoice.store?.name?.substring(0, 10) || 'N/A', xPos, yPosition); xPos += colWidths[3];
          doc.text(invoice.status || '', xPos, yPosition); xPos += colWidths[4];
          doc.text(invoice.currency?.code?.substring(0, 6) || invoice.currency?.name?.substring(0, 6) || 'N/A', xPos, yPosition); xPos += colWidths[5];
          doc.text(invoice.subtotal ? parseFloat(invoice.subtotal).toFixed(2) : '0.00', xPos, yPosition); xPos += colWidths[6];
          doc.text(invoice.tax_amount ? parseFloat(invoice.tax_amount).toFixed(2) : '0.00', xPos, yPosition); xPos += colWidths[7];
          doc.text(invoice.discount_amount ? parseFloat(invoice.discount_amount).toFixed(2) : '0.00', xPos, yPosition); xPos += colWidths[8];
          doc.text(invoice.total_amount ? parseFloat(invoice.total_amount).toFixed(2) : '0.00', xPos, yPosition); xPos += colWidths[9];
          doc.text(invoice.valid_until ? new Date(invoice.valid_until).toLocaleDateString() : 'No limit', xPos, yPosition); xPos += colWidths[10];
          doc.text(invoice.createdByUser ? `${invoice.createdByUser.first_name || ''} ${invoice.createdByUser.last_name || ''}`.trim().substring(0, 10) || 'System' : 'System', xPos, yPosition); xPos += colWidths[11];
          doc.text(invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : 'N/A', xPos, yPosition); xPos += colWidths[12];
          doc.text(invoice.sentByUser ? `${invoice.sentByUser.first_name || ''} ${invoice.sentByUser.last_name || ''}`.trim().substring(0, 10) || '-' : '-', xPos, yPosition); xPos += colWidths[13];
          doc.text(invoice.sent_at ? new Date(invoice.sent_at).toLocaleDateString() : '-', xPos, yPosition); xPos += colWidths[14];
          doc.text(invoice.acceptedByUser ? `${invoice.acceptedByUser.first_name || ''} ${invoice.acceptedByUser.last_name || ''}`.trim().substring(0, 10) || '-' : '-', xPos, yPosition); xPos += colWidths[15];
          doc.text(invoice.accepted_at ? new Date(invoice.accepted_at).toLocaleDateString() : '-', xPos, yPosition); xPos += colWidths[16];
          doc.text(invoice.rejectedByUser ? `${invoice.rejectedByUser.first_name || ''} ${invoice.rejectedByUser.last_name || ''}`.trim().substring(0, 10) || '-' : '-', xPos, yPosition); xPos += colWidths[17];
          doc.text(invoice.rejected_at ? new Date(invoice.rejected_at).toLocaleDateString() : '-', xPos, yPosition);

          yPosition += 15;
        });

        // Add footer
        doc.fontSize(8).font('Helvetica').text(`Generated by EasyMauzo - Page ${doc.bufferedPageRange().count}`, 50, doc.page.height - 50);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = ExportService; 