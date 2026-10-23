import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const COLORS = {
	darkBlue: [22, 35, 61],
	green: [23, 128, 79],
	greenBg: [223, 245, 232],
	red: [163, 53, 43],
	redBg: [255, 225, 221],
	gray: [109, 119, 136],
	grayBg: [238, 241, 247],
	white: [255, 255, 255],
	black: [26, 26, 46],
	lightBorder: [204, 204, 204],
};

export function generateReportPdf(result, formName) {
	const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
	const pageW = doc.internal.pageSize.getWidth();
	const pageH = doc.internal.pageSize.getHeight();
	const margin = 15;
	const contentW = pageW - margin * 2;
	let y = margin;

	function checkPage(needed) {
		if (y + needed > pageH - margin) {
			doc.addPage();
			y = margin;
		}
	}

	function setColor(rgb) {
		doc.setTextColor(rgb[0], rgb[1], rgb[2]);
	}

	function setFill(rgb) {
		doc.setFillColor(rgb[0], rgb[1], rgb[2]);
	}

	function setDraw(rgb) {
		doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
	}

	// ── Title ──
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(18);
	setColor(COLORS.darkBlue);
	doc.text('ZARA — Form Verification Report', margin, y + 6);
	y += 12;

	// ── Meta ──
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(10);
	setColor(COLORS.gray);
	const metaLines = doc.splitTextToSize(
		`Form: ${formName || '—'}     |     Checked on: ${new Date().toLocaleString()}`,
		contentW
	);
	doc.text(metaLines, margin, y);
	y += metaLines.length * 4.5 + 4;

	// ── Status badge ──
	const statusText =
		result.overallStatus === 'pass'
			? 'PASSED — all fields matched'
			: result.overallStatus === 'fail'
				? 'REJECTED — mismatches found, see below'
				: 'UNVERIFIABLE';
	const badgeColor =
		result.overallStatus === 'pass'
			? COLORS.green
			: result.overallStatus === 'fail'
				? COLORS.red
				: COLORS.gray;
	const badgeBg =
		result.overallStatus === 'pass'
			? COLORS.greenBg
			: result.overallStatus === 'fail'
				? COLORS.redBg
				: COLORS.grayBg;

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	setColor(badgeColor);
	const tw = doc.getTextWidth(statusText);
	doc.roundedRect(margin, y - 4, tw + 10, 8, 2, 2, 'F');
	setColor(badgeColor);
	doc.text(statusText, margin + 5, y + 0.5);
	y += 12;

	// ── Summary counts ──
	const matchCount = result.checks.filter((c) => c.status === 'match').length;
	const mismatchCount = result.checks.filter((c) => c.status === 'mismatch').length;
	const unverifiedCount = result.checks.filter((c) => c.status === 'unverifiable').length;

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);

	const pills = [
		{ label: `${matchCount} match`, color: COLORS.green, bg: COLORS.greenBg },
		{ label: `${mismatchCount} mismatch`, color: COLORS.red, bg: COLORS.redBg },
		{ label: `${unverifiedCount} unverified`, color: COLORS.gray, bg: COLORS.grayBg },
	];

	let px = margin;
	for (const pill of pills) {
		const pw = doc.getTextWidth(pill.label) + 8;
		setFill(pill.bg);
		doc.roundedRect(px, y - 3.5, pw, 6, 1.5, 1.5, 'F');
		setColor(pill.color);
		doc.text(pill.label, px + 4, y);
		px += pw + 4;
	}
	y += 8;

	// ── Mismatch table ──
	const mismatchChecks = result.checks.filter((c) => c.status === 'mismatch');
	if (mismatchChecks.length > 0) {
		checkPage(20);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(12);
		setColor(COLORS.darkBlue);
		doc.text('Fields that need correction', margin, y + 5);
		y += 9;

		const mismatchData = mismatchChecks.map((c) => [
			c.field || '',
			c.formValue || '',
			c.attachmentValue || '',
			c.note || '',
		]);

		autoTable(doc, {
		 startY: y,
			margin: { left: margin, right: margin },
			head: [['Field', 'Value on Form', 'Should Be (per attachment)', 'Note']],
			body: mismatchData,
			theme: 'grid',
			styles: {
				fontSize: 8,
				cellPadding: 3,
				lineColor: COLORS.lightBorder,
				lineWidth: 0.2,
				textColor: COLORS.black,
				font: 'helvetica',
				overflow: 'linebreak',
				cellWidth: 'wrap',
			},
			headStyles: {
				fillColor: COLORS.grayBg,
				textColor: COLORS.darkBlue,
				fontStyle: 'bold',
				fontSize: 8,
			},
			alternateRowStyles: {
				fillColor: [250, 250, 252],
			},
			columnStyles: {
				0: { cellWidth: 42 },
				1: { cellWidth: 42 },
				2: { cellWidth: 50 },
				3: { cellWidth: 36 },
			},
		});

		y = doc.lastAutoTable.finalY + 10;
	}

	// ── All fields table ──
	checkPage(20);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(12);
	setColor(COLORS.darkBlue);
	doc.text('All checked fields', margin, y + 5);
	y += 9;

	const allData = result.checks.map((c) => [
		c.field || '',
		c.formValue || '',
		c.attachmentValue || '',
		c.status === 'unverifiable' ? 'unverified' : c.status,
	]);

	autoTable(doc, {
		startY: y,
		margin: { left: margin, right: margin },
		head: [['Field', 'Value on Form', 'Value on Attachment', 'Result']],
		body: allData,
		theme: 'grid',
		styles: {
			fontSize: 8,
			cellPadding: 3,
			lineColor: COLORS.lightBorder,
			lineWidth: 0.2,
			textColor: COLORS.black,
			font: 'helvetica',
			overflow: 'linebreak',
			cellWidth: 'wrap',
		},
		headStyles: {
			fillColor: COLORS.grayBg,
			textColor: COLORS.darkBlue,
			fontStyle: 'bold',
			fontSize: 8,
		},
		alternateRowStyles: {
			fillColor: [250, 250, 252],
		},
		columnStyles: {
			0: { cellWidth: 42 },
			1: { cellWidth: 44 },
			2: { cellWidth: 50 },
			3: { cellWidth: 24, fontStyle: 'bold' },
		},
		didParseCell: function (data) {
			if (data.section === 'body' && data.column.index === 3) {
				const val = String(data.cell.raw).toLowerCase();
				if (val === 'match') data.cell.styles.textColor = COLORS.green;
				else if (val === 'mismatch') data.cell.styles.textColor = COLORS.red;
				else data.cell.styles.textColor = COLORS.gray;
			}
		},
	});

	doc.save(`zara-report-${formName || 'form'}.pdf`);
}
