Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "GridGate - Render Update Manager"
$form.Size = New-Object System.Drawing.Size(820, 650)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(52, 52, 52)
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.MinimumSize = New-Object System.Drawing.Size(760, 600)

$title = New-Object System.Windows.Forms.Label
$title.Text = "GridGate - Render Update Manager"
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 17)
$title.ForeColor = [System.Drawing.Color]::White
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 16)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Copy a new GridGate version into the permanent Git project, test it, then push to GitHub / Render."
$subtitle.ForeColor = [System.Drawing.Color]::Gainsboro
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(22, 52)
$form.Controls.Add($subtitle)

function New-PathRow {
    param(
        [string]$LabelText,
        [int]$Y
    )
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $LabelText
    $label.ForeColor = [System.Drawing.Color]::WhiteSmoke
    $label.Location = New-Object System.Drawing.Point(22, $Y)
    $label.Size = New-Object System.Drawing.Size(210, 22)
    $form.Controls.Add($label)

    $box = New-Object System.Windows.Forms.TextBox
    $box.Location = New-Object System.Drawing.Point(22, ($Y + 24))
    $box.Size = New-Object System.Drawing.Size(660, 27)
    $box.BackColor = [System.Drawing.Color]::FromArgb(72, 72, 72)
    $box.ForeColor = [System.Drawing.Color]::White
    $box.BorderStyle = "FixedSingle"
    $form.Controls.Add($box)

    $browse = New-Object System.Windows.Forms.Button
    $browse.Text = "Browse..."
    $browse.Location = New-Object System.Drawing.Point(690, ($Y + 23))
    $browse.Size = New-Object System.Drawing.Size(90, 29)
    $browse.BackColor = [System.Drawing.Color]::FromArgb(88, 88, 88)
    $browse.ForeColor = [System.Drawing.Color]::White
    $browse.FlatStyle = "Flat"
    $browse.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(115, 115, 115)
    $form.Controls.Add($browse)

    $browse.Add_Click({
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = $LabelText
        $dlg.ShowNewFolderButton = $false
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $box.Text = $dlg.SelectedPath
        }
    }.GetNewClosure())

    return $box
}

$sourceBox = New-PathRow -LabelText "New GridGate version folder" -Y 88
$repoBox = New-PathRow -LabelText "Permanent Git repository folder (.git must exist here)" -Y 158

$commitLabel = New-Object System.Windows.Forms.Label
$commitLabel.Text = "Commit message"
$commitLabel.ForeColor = [System.Drawing.Color]::WhiteSmoke
$commitLabel.Location = New-Object System.Drawing.Point(22, 228)
$commitLabel.Size = New-Object System.Drawing.Size(210, 22)
$form.Controls.Add($commitLabel)

$commitBox = New-Object System.Windows.Forms.TextBox
$commitBox.Text = "Update GridGate"
$commitBox.Location = New-Object System.Drawing.Point(22, 252)
$commitBox.Size = New-Object System.Drawing.Size(758, 27)
$commitBox.BackColor = [System.Drawing.Color]::FromArgb(72, 72, 72)
$commitBox.ForeColor = [System.Drawing.Color]::White
$commitBox.BorderStyle = "FixedSingle"
$form.Controls.Add($commitBox)

$updateButton = New-Object System.Windows.Forms.Button
$updateButton.Text = "Update Render"
$updateButton.Location = New-Object System.Drawing.Point(22, 294)
$updateButton.Size = New-Object System.Drawing.Size(150, 38)
$updateButton.BackColor = [System.Drawing.Color]::FromArgb(75, 116, 170)
$updateButton.ForeColor = [System.Drawing.Color]::White
$updateButton.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)
$updateButton.FlatStyle = "Flat"
$updateButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(108, 167, 255)
$form.Controls.Add($updateButton)

$validateButton = New-Object System.Windows.Forms.Button
$validateButton.Text = "Validate Paths"
$validateButton.Location = New-Object System.Drawing.Point(180, 294)
$validateButton.Size = New-Object System.Drawing.Size(130, 38)
$validateButton.BackColor = [System.Drawing.Color]::FromArgb(82, 82, 82)
$validateButton.ForeColor = [System.Drawing.Color]::White
$validateButton.FlatStyle = "Flat"
$validateButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(115, 115, 115)
$form.Controls.Add($validateButton)

$openRepoButton = New-Object System.Windows.Forms.Button
$openRepoButton.Text = "Open Repo Folder"
$openRepoButton.Location = New-Object System.Drawing.Point(318, 294)
$openRepoButton.Size = New-Object System.Drawing.Size(135, 38)
$openRepoButton.BackColor = [System.Drawing.Color]::FromArgb(82, 82, 82)
$openRepoButton.ForeColor = [System.Drawing.Color]::White
$openRepoButton.FlatStyle = "Flat"
$openRepoButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(115, 115, 115)
$form.Controls.Add($openRepoButton)

$clearButton = New-Object System.Windows.Forms.Button
$clearButton.Text = "Clear Log"
$clearButton.Location = New-Object System.Drawing.Point(461, 294)
$clearButton.Size = New-Object System.Drawing.Size(100, 38)
$clearButton.BackColor = [System.Drawing.Color]::FromArgb(82, 82, 82)
$clearButton.ForeColor = [System.Drawing.Color]::White
$clearButton.FlatStyle = "Flat"
$clearButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(115, 115, 115)
$form.Controls.Add($clearButton)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Ready"
$statusLabel.ForeColor = [System.Drawing.Color]::LightGreen
$statusLabel.Location = New-Object System.Drawing.Point(585, 303)
$statusLabel.Size = New-Object System.Drawing.Size(195, 24)
$statusLabel.TextAlign = "MiddleRight"
$form.Controls.Add($statusLabel)

$logLabel = New-Object System.Windows.Forms.Label
$logLabel.Text = "LOG"
$logLabel.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)
$logLabel.ForeColor = [System.Drawing.Color]::White
$logLabel.Location = New-Object System.Drawing.Point(22, 348)
$logLabel.Size = New-Object System.Drawing.Size(80, 22)
$form.Controls.Add($logLabel)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Location = New-Object System.Drawing.Point(22, 372)
$logBox.Size = New-Object System.Drawing.Size(758, 210)
$logBox.Anchor = "Top,Bottom,Left,Right"
$logBox.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$logBox.ForeColor = [System.Drawing.Color]::Gainsboro
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$logBox.ReadOnly = $true
$logBox.BorderStyle = "FixedSingle"
$logBox.DetectUrls = $true
$form.Controls.Add($logBox)

$note = New-Object System.Windows.Forms.Label
$note.Text = "Preserved automatically: .git, node_modules, .wrangler and .dev.vars"
$note.ForeColor = [System.Drawing.Color]::Silver
$note.Location = New-Object System.Drawing.Point(22, 590)
$note.Size = New-Object System.Drawing.Size(758, 22)
$note.Anchor = "Bottom,Left,Right"
$form.Controls.Add($note)

function Write-Log {
    param(
        [string]$Text,
        [System.Drawing.Color]$Color = [System.Drawing.Color]::Gainsboro
    )
    $timestamp = (Get-Date).ToString("HH:mm:ss")
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.SelectionLength = 0
    $logBox.SelectionColor = [System.Drawing.Color]::Gray
    $logBox.AppendText("[$timestamp] ")
    $logBox.SelectionColor = $Color
    $logBox.AppendText($Text + [Environment]::NewLine)
    $logBox.SelectionColor = $logBox.ForeColor
    $logBox.ScrollToCaret()
    [System.Windows.Forms.Application]::DoEvents()
}

function Set-Status {
    param([string]$Text, [System.Drawing.Color]$Color)
    $statusLabel.Text = $Text
    $statusLabel.ForeColor = $Color
    [System.Windows.Forms.Application]::DoEvents()
}

function Validate-Inputs {
    $source = $sourceBox.Text.Trim()
    $repo = $repoBox.Text.Trim()

    if ([string]::IsNullOrWhiteSpace($source) -or -not (Test-Path $source)) {
        Write-Log "ERROR: New version folder does not exist: $source" ([System.Drawing.Color]::Salmon)
        return $false
    }
    if (-not (Test-Path (Join-Path $source "package.json"))) {
        Write-Log "ERROR: package.json was not found in the new version folder." ([System.Drawing.Color]::Salmon)
        return $false
    }
    if ([string]::IsNullOrWhiteSpace($repo) -or -not (Test-Path $repo)) {
        Write-Log "ERROR: Permanent Git repository folder does not exist: $repo" ([System.Drawing.Color]::Salmon)
        return $false
    }
    if (-not (Test-Path (Join-Path $repo ".git"))) {
        Write-Log "ERROR: .git was not found in the permanent repository folder." ([System.Drawing.Color]::Salmon)
        Write-Log "Choose the OLD project folder that you originally connected to GitHub / Render." ([System.Drawing.Color]::Khaki)
        return $false
    }

    Write-Log "Paths are valid." ([System.Drawing.Color]::LightGreen)
    return $true
}

function Run-ProcessLogged {
    param(
        [string]$FileName,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$StepName
    )

    Write-Log "---- $StepName ----" ([System.Drawing.Color]::LightSkyBlue)
    Write-Log "> $FileName $Arguments" ([System.Drawing.Color]::Silver)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FileName
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $null = $proc.Start()

    while (-not $proc.HasExited) {
        while (-not $proc.StandardOutput.EndOfStream) {
            $line = $proc.StandardOutput.ReadLine()
            if ($null -ne $line) { Write-Log $line }
        }
        while (-not $proc.StandardError.EndOfStream) {
            $line = $proc.StandardError.ReadLine()
            if ($null -ne $line) { Write-Log $line ([System.Drawing.Color]::Khaki) }
        }
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 50
    }

    while (-not $proc.StandardOutput.EndOfStream) {
        $line = $proc.StandardOutput.ReadLine()
        if ($null -ne $line) { Write-Log $line }
    }
    while (-not $proc.StandardError.EndOfStream) {
        $line = $proc.StandardError.ReadLine()
        if ($null -ne $line) { Write-Log $line ([System.Drawing.Color]::Khaki) }
    }

    if ($proc.ExitCode -eq 0) {
        Write-Log "$StepName completed successfully." ([System.Drawing.Color]::LightGreen)
        return $true
    } else {
        Write-Log "$StepName FAILED. Exit code: $($proc.ExitCode)" ([System.Drawing.Color]::Salmon)
        return $false
    }
}

$validateButton.Add_Click({
    Set-Status "Checking..." ([System.Drawing.Color]::Khaki)
    if (Validate-Inputs) {
        Set-Status "Paths OK" ([System.Drawing.Color]::LightGreen)
    } else {
        Set-Status "Invalid paths" ([System.Drawing.Color]::Salmon)
    }
})

$clearButton.Add_Click({
    $logBox.Clear()
    Write-Log "Log cleared."
})

$openRepoButton.Add_Click({
    $path = $repoBox.Text.Trim()
    if (Test-Path $path) {
        Start-Process explorer.exe -ArgumentList "`"$path`""
    } else {
        Write-Log "Repository folder does not exist." ([System.Drawing.Color]::Salmon)
    }
})

$updateButton.Add_Click({
    $updateButton.Enabled = $false
    $validateButton.Enabled = $false

    try {
        Set-Status "Validating..." ([System.Drawing.Color]::Khaki)
        if (-not (Validate-Inputs)) {
            Set-Status "Stopped" ([System.Drawing.Color]::Salmon)
            return
        }

        $source = (Resolve-Path $sourceBox.Text.Trim()).Path
        $repo = (Resolve-Path $repoBox.Text.Trim()).Path
        $message = $commitBox.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($message)) { $message = "Update GridGate" }

        $confirm = [System.Windows.Forms.MessageBox]::Show(
            "New version:`n$source`n`nPermanent Git repo:`n$repo`n`nThe new version will overwrite project files while preserving .git and local caches.`n`nContinue?",
            "Confirm Render Update",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
        if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
            Write-Log "Update cancelled by user." ([System.Drawing.Color]::Khaki)
            Set-Status "Cancelled" ([System.Drawing.Color]::Khaki)
            return
        }

        Write-Log "Starting Render update..." ([System.Drawing.Color]::LightSkyBlue)
        Write-Log "Source: $source"
        Write-Log "Repository: $repo"

        Set-Status "Copying files..." ([System.Drawing.Color]::Khaki)
        $roboArgs = "`"$source`" `"$repo`" /MIR /XD `".git`" `"node_modules`" `".wrangler`" /XF `".dev.vars`" `"DEPLOY_RENDER_UPDATE.bat`""
        Write-Log "---- Copy new version ----" ([System.Drawing.Color]::LightSkyBlue)
        Write-Log "> robocopy $roboArgs" ([System.Drawing.Color]::Silver)

        $copyProc = Start-Process -FilePath "robocopy.exe" -ArgumentList $roboArgs -WorkingDirectory $repo -Wait -PassThru -NoNewWindow
        if ($copyProc.ExitCode -ge 8) {
            Write-Log "Copy FAILED. Robocopy exit code: $($copyProc.ExitCode)" ([System.Drawing.Color]::Salmon)
            Set-Status "Copy failed" ([System.Drawing.Color]::Salmon)
            return
        }
        Write-Log "Files copied successfully. Robocopy code: $($copyProc.ExitCode)" ([System.Drawing.Color]::LightGreen)

        Set-Status "npm install..." ([System.Drawing.Color]::Khaki)
        if (-not (Run-ProcessLogged "cmd.exe" "/c npm install" $repo "npm install")) {
            Set-Status "npm install failed" ([System.Drawing.Color]::Salmon)
            return
        }

        Set-Status "Running tests..." ([System.Drawing.Color]::Khaki)
        if (-not (Run-ProcessLogged "cmd.exe" "/c npm test" $repo "npm test")) {
            Set-Status "Tests failed" ([System.Drawing.Color]::Salmon)
            Write-Log "Nothing was pushed to GitHub / Render." ([System.Drawing.Color]::Khaki)
            return
        }

        Set-Status "Checking Git..." ([System.Drawing.Color]::Khaki)
        if (-not (Run-ProcessLogged "git.exe" "status --short" $repo "git status")) {
            Set-Status "Git error" ([System.Drawing.Color]::Salmon)
            return
        }

        Set-Status "Staging..." ([System.Drawing.Color]::Khaki)
        if (-not (Run-ProcessLogged "git.exe" "add -A" $repo "git add")) {
            Set-Status "Git add failed" ([System.Drawing.Color]::Salmon)
            return
        }

        $check = New-Object System.Diagnostics.ProcessStartInfo
        $check.FileName = "git.exe"
        $check.Arguments = "diff --cached --quiet"
        $check.WorkingDirectory = $repo
        $check.UseShellExecute = $false
        $check.CreateNoWindow = $true
        $p = [System.Diagnostics.Process]::Start($check)
        $p.WaitForExit()

        if ($p.ExitCode -eq 0) {
            Write-Log "No changed files were detected. Nothing to commit." ([System.Drawing.Color]::Khaki)
            Set-Status "No changes" ([System.Drawing.Color]::Khaki)
            return
        }

        $safeMessage = $message.Replace('"', '\"')
        Set-Status "Committing..." ([System.Drawing.Color]::Khaki)
        if (-not (Run-ProcessLogged "git.exe" "commit -m `"$safeMessage`"" $repo "git commit")) {
            Set-Status "Commit failed" ([System.Drawing.Color]::Salmon)
            return
        }

        Set-Status "Pushing..." ([System.Drawing.Color]::Khaki)
        if (-not (Run-ProcessLogged "git.exe" "push" $repo "git push")) {
            Set-Status "Push failed" ([System.Drawing.Color]::Salmon)
            Write-Log "The commit remains saved locally. You can retry push later." ([System.Drawing.Color]::Khaki)
            return
        }

        Write-Log "==================================================" ([System.Drawing.Color]::LightGreen)
        Write-Log "SUCCESS: GitHub received the new version." ([System.Drawing.Color]::LightGreen)
        Write-Log "If Render Auto-Deploy is enabled, Render should now build and deploy this commit automatically." ([System.Drawing.Color]::LightGreen)
        Write-Log "Open the Render dashboard and wait until the service status becomes LIVE." ([System.Drawing.Color]::White)
        Write-Log "==================================================" ([System.Drawing.Color]::LightGreen)
        Set-Status "SUCCESS" ([System.Drawing.Color]::LightGreen)

        [System.Windows.Forms.MessageBox]::Show(
            "Update pushed successfully.`n`nRender should now auto-deploy the new commit.",
            "GridGate Update Complete",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
    catch {
        Write-Log ("UNEXPECTED ERROR: " + $_.Exception.Message) ([System.Drawing.Color]::Salmon)
        Set-Status "Error" ([System.Drawing.Color]::Salmon)
    }
    finally {
        $updateButton.Enabled = $true
        $validateButton.Enabled = $true
    }
})

Write-Log "Ready. Select the new version folder and the permanent Git repository folder."
Write-Log "The window stays open on errors so you can read or copy the log."

[void]$form.ShowDialog()
